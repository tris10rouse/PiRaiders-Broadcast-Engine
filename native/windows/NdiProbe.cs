// Test-only NDI receiver. No SDK installer or link library is required.
// ABI declarations are derived from CasparCG v2.5.1-stable's NDI headers.
// The following notice applies to those header-derived declarations ONLY,
// not to the proprietary NDI runtime or SDK as a whole:
// Copyright (C) 2023-2024 Vizrt NDI AB. All rights reserved.
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
// of the Software, and to permit persons to whom the Software is furnished to do
// so, subject to the following conditions: The above copyright notice and this
// permission notice shall be included in all copies or substantial portions of
// the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO
// EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
// OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,
// ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.
using System;
using System.Collections.Generic;
using System.Collections;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

internal sealed class ProbeFailure : Exception
{
    internal readonly string Code;
    internal ProbeFailure(string code) { Code = code; }
}

internal static class NdiProbe
{
    private const int Video = 1;
    private const uint Bgra = 0x41524742;
    private const uint Bgrx = 0x58524742;
    private const int GlobalDeadlineMs = 8 * 60 * 1000;
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    private static readonly Stopwatch Lifetime = Stopwatch.StartNew();
    private static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 4096, RecursionLimit = 8 };
    private static IntPtr Library, Finder, Receiver, NameMemory, ReceiverNameMemory;
    private static string TargetLabel, SourceName, SourceHash, EvidenceDirectory, Token;
    private static bool Initialized;

    [StructLayout(LayoutKind.Sequential)]
    private struct Source { internal IntPtr Name, Url; }
    [StructLayout(LayoutKind.Sequential)]
    private struct FindCreate
    {
        [MarshalAs(UnmanagedType.I1)] internal bool ShowLocal;
        internal IntPtr Groups, ExtraIps;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct RecvCreate
    {
        internal Source Source;
        internal int ColorFormat, Bandwidth;
        [MarshalAs(UnmanagedType.I1)] internal bool AllowFields;
        internal IntPtr ReceiverName;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct VideoFrame
    {
        internal int Width, Height;
        internal uint FourCC;
        internal int FrameN, FrameD;
        internal float Aspect;
        internal int FrameFormat;
        internal long Timecode;
        internal IntPtr Data;
        internal int Stride;
        internal IntPtr Metadata;
        internal long Timestamp;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibraryEx(string filename, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FreeLibrary(IntPtr module);

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)] private delegate bool BoolVoid();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void VoidVoid();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr PtrVoid();
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr FindNew(ref FindCreate settings);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void Destroy(IntPtr instance);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr FindSources(IntPtr instance, out uint count);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    [return: MarshalAs(UnmanagedType.I1)] private delegate bool FindWait(IntPtr instance, uint milliseconds);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate IntPtr RecvNew(ref RecvCreate settings);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void RecvConnect(IntPtr instance, ref Source source);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Capture(IntPtr instance, ref VideoFrame video, IntPtr audio, IntPtr metadata, uint milliseconds);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate void FreeVideo(IntPtr instance, ref VideoFrame video);
    [UnmanagedFunctionPointer(CallingConvention.Cdecl)] private delegate int Connections(IntPtr instance);

    private static VoidVoid NdiDestroy;
    private static Destroy FindDestroy, RecvDestroy;
    private static FindSources GetSources;
    private static FindWait WaitSources;
    private static RecvNew CreateReceiver;
    private static RecvConnect ConnectReceiver;
    private static Capture CaptureVideo;
    private static FreeVideo ReleaseVideo;
    private static Connections GetConnections;

    private static void Require(bool value, string code) { if (!value) throw new ProbeFailure(code); }
    private static void CheckDeadline() { Require(Lifetime.ElapsedMilliseconds < GlobalDeadlineMs, "PROBE_DEADLINE"); }
    private static T Symbol<T>(string name) where T : class
    {
        IntPtr address = GetProcAddress(Library, name);
        Require(address != IntPtr.Zero, "RUNTIME_SYMBOL");
        T result = Marshal.GetDelegateForFunctionPointer(address, typeof(T)) as T;
        Require(result != null, "RUNTIME_SYMBOL");
        return result;
    }
    private static void Offset(Type type, string field, int expected)
    {
        Require(Marshal.OffsetOf(type, field).ToInt32() == expected, "ABI_LAYOUT");
    }
    private static void AssertAbi()
    {
        Require(IntPtr.Size == 8, "X64_REQUIRED");
        Require(Marshal.SizeOf(typeof(Source)) == 16 && Marshal.SizeOf(typeof(FindCreate)) == 24 &&
            Marshal.SizeOf(typeof(RecvCreate)) == 40 && Marshal.SizeOf(typeof(VideoFrame)) == 72, "ABI_LAYOUT");
        Offset(typeof(Source), "Url", 8);
        Offset(typeof(FindCreate), "Groups", 8); Offset(typeof(FindCreate), "ExtraIps", 16);
        Offset(typeof(RecvCreate), "ColorFormat", 16); Offset(typeof(RecvCreate), "Bandwidth", 20);
        Offset(typeof(RecvCreate), "AllowFields", 24); Offset(typeof(RecvCreate), "ReceiverName", 32);
        Offset(typeof(VideoFrame), "FourCC", 8); Offset(typeof(VideoFrame), "FrameN", 12);
        Offset(typeof(VideoFrame), "Aspect", 20); Offset(typeof(VideoFrame), "FrameFormat", 24);
        Offset(typeof(VideoFrame), "Timecode", 32); Offset(typeof(VideoFrame), "Data", 40);
        Offset(typeof(VideoFrame), "Stride", 48); Offset(typeof(VideoFrame), "Metadata", 56);
        Offset(typeof(VideoFrame), "Timestamp", 64);
    }
    private static string ReadUtf8(IntPtr value, int maximum)
    {
        Require(value != IntPtr.Zero, "RUNTIME_STRING");
        int length = 0;
        while (length < maximum && Marshal.ReadByte(value, length) != 0) length++;
        Require(length < maximum, "RUNTIME_STRING_LIMIT");
        byte[] bytes = new byte[length]; Marshal.Copy(value, bytes, 0, length);
        try { return Utf8.GetString(bytes); } catch { throw new ProbeFailure("RUNTIME_STRING_ENCODING"); }
    }
    private static IntPtr AllocateUtf8(string value)
    {
        byte[] bytes = Utf8.GetBytes(value + "\0");
        IntPtr result = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes, 0, result, bytes.Length); return result;
    }
    private static string Hash(string value)
    {
        using (SHA256 sha = SHA256.Create())
        {
            byte[] digest = sha.ComputeHash(Utf8.GetBytes(value));
            StringBuilder text = new StringBuilder(64);
            foreach (byte item in digest) text.Append(item.ToString("x2"));
            return text.ToString();
        }
    }
    private static bool MatchSource(string value)
    {
        string prefix = Environment.MachineName + " (";
        return value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) &&
            String.Equals(value.Substring(prefix.Length), TargetLabel + ")", StringComparison.Ordinal);
    }
    private static int MatchingSources(out string match)
    {
        CheckDeadline(); match = null;
        uint count; IntPtr sources = GetSources(Finder, out count);
        Require(count <= 10000 && (count == 0 || sources != IntPtr.Zero), "SOURCE_LIST_INVALID");
        int matches = 0;
        for (uint i = 0; i < count; i++)
        {
            Source source = (Source)Marshal.PtrToStructure(IntPtr.Add(sources, checked((int)i * 16)), typeof(Source));
            string name = ReadUtf8(source.Name, 4096);
            if (MatchSource(name)) { matches++; match = name; }
        }
        return matches;
    }
    private static string Initialize(string dllPath)
    {
        AssertAbi();
        Library = LoadLibraryEx(dllPath, IntPtr.Zero, 0x1100);
        Require(Library != IntPtr.Zero, "RUNTIME_LOAD");
        BoolVoid cpu = Symbol<BoolVoid>("NDIlib_is_supported_CPU");
        Require(cpu(), "CPU_UNSUPPORTED");
        BoolVoid init = Symbol<BoolVoid>("NDIlib_initialize");
        NdiDestroy = Symbol<VoidVoid>("NDIlib_destroy");
        Require(init(), "RUNTIME_INITIALIZE"); Initialized = true;
        string version = ReadUtf8(Symbol<PtrVoid>("NDIlib_version")(), 256);
        Require(version.Length > 0 && version.Length <= 255 && !Regex.IsMatch(version, @"[\x00-\x1f\x7f]"), "RUNTIME_VERSION_FORMAT");
        FindNew createFinder = Symbol<FindNew>("NDIlib_find_create_v2");
        FindDestroy = Symbol<Destroy>("NDIlib_find_destroy");
        RecvDestroy = Symbol<Destroy>("NDIlib_recv_destroy");
        GetSources = Symbol<FindSources>("NDIlib_find_get_current_sources");
        WaitSources = Symbol<FindWait>("NDIlib_find_wait_for_sources");
        CreateReceiver = Symbol<RecvNew>("NDIlib_recv_create_v3");
        ConnectReceiver = Symbol<RecvConnect>("NDIlib_recv_connect");
        CaptureVideo = Symbol<Capture>("NDIlib_recv_capture_v3");
        ReleaseVideo = Symbol<FreeVideo>("NDIlib_recv_free_video_v2");
        GetConnections = Symbol<Connections>("NDIlib_recv_get_no_connections");
        FindCreate settings = new FindCreate { ShowLocal = true };
        Finder = createFinder(ref settings); Require(Finder != IntPtr.Zero, "FINDER_CREATE");
        return version;
    }
    private static Dictionary<string, object> Stats()
    {
        return new Dictionary<string, object> {
            { "matchedFrames", 0 }, { "distinctTimestamps", 0 }, { "sourceIdentityHash", SourceHash },
            { "connections", Receiver == IntPtr.Zero ? 0 : GetConnections(Receiver) }, { "format", null }
        };
    }
    private static void Absent(int durationMs)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < durationMs)
        {
            string unused; Require(MatchingSources(out unused) == 0, "SOURCE_PRESENT");
            WaitSources(Finder, 50);
        }
    }
    private static void Discover(int timeoutMs)
    {
        Stopwatch watch = Stopwatch.StartNew(); string selected = null;
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            int count = MatchingSources(out selected); Require(count <= 1, "SOURCE_AMBIGUOUS");
            if (count == 1) break;
            WaitSources(Finder, 100);
        }
        Require(selected != null, "SOURCE_NOT_FOUND");
        if (Receiver != IntPtr.Zero)
        {
            Require(selected == SourceName, "SOURCE_IDENTITY_CHANGED");
            Source sameSource = new Source { Name = NameMemory, Url = IntPtr.Zero };
            ConnectReceiver(Receiver, ref sameSource);
            return;
        }
        SourceName = selected; SourceHash = Hash(selected);
        if (NameMemory != IntPtr.Zero) { Marshal.FreeHGlobal(NameMemory); NameMemory = IntPtr.Zero; }
        NameMemory = AllocateUtf8(selected);
        if (ReceiverNameMemory == IntPtr.Zero) ReceiverNameMemory = AllocateUtf8("PiRaiders CI verification receiver");
        RecvCreate settings = new RecvCreate {
            Source = new Source { Name = NameMemory, Url = IntPtr.Zero }, ColorFormat = 0,
            Bandwidth = 100, AllowFields = false, ReceiverName = ReceiverNameMemory
        };
        Receiver = CreateReceiver(ref settings); Require(Receiver != IntPtr.Zero, "RECEIVER_CREATE");
    }
    private static void ValidateFrame(VideoFrame frame)
    {
        Require(frame.Width == 1920 && frame.Height == 1080 && frame.FrameN > 0 && frame.FrameD > 0 && (long)frame.FrameN == 30L * frame.FrameD &&
            frame.FrameFormat == 1 && (frame.FourCC == Bgra || frame.FourCC == Bgrx), "VIDEO_FORMAT");
        Require(frame.Data != IntPtr.Zero && frame.Stride >= frame.Width * 4 && frame.Stride <= frame.Width * 4 + 4096, "VIDEO_BUFFER");
        Require(frame.Timestamp != Int64.MaxValue && frame.Timestamp != 0, "VIDEO_TIMESTAMP");
    }
    private static bool PixelsMatch(VideoFrame frame, int[] expected)
    {
        int[,] points = { { 960, 540 }, { 480, 270 }, { 1440, 270 }, { 480, 810 }, { 1440, 810 } };
        for (int n = 0; n < 5; n++)
        {
            int offset = checked(points[n, 1] * frame.Stride + points[n, 0] * 4);
            int b = Marshal.ReadByte(frame.Data, offset), g = Marshal.ReadByte(frame.Data, offset + 1), r = Marshal.ReadByte(frame.Data, offset + 2);
            int alpha = frame.FourCC == Bgrx ? 255 : Marshal.ReadByte(frame.Data, offset + 3);
            if (alpha < 250 || Math.Abs(r - expected[0]) > 18 || Math.Abs(g - expected[1]) > 18 || Math.Abs(b - expected[2]) > 18) return false;
        }
        return true;
    }
    private static void SavePng(VideoFrame frame, string name)
    {
        string target = Path.Combine(EvidenceDirectory, name + ".png");
        string temporary = Path.Combine(EvidenceDirectory, name + "." + Guid.NewGuid().ToString("N") + ".partial");
        try
        {
            using (Bitmap bitmap = new Bitmap(frame.Width, frame.Height, PixelFormat.Format32bppArgb))
            {
                BitmapData data = bitmap.LockBits(new Rectangle(0, 0, frame.Width, frame.Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
                try
                {
                    int widthBytes = checked(frame.Width * 4); byte[] row = new byte[widthBytes];
                    for (int y = 0; y < frame.Height; y++)
                    {
                        Marshal.Copy(IntPtr.Add(frame.Data, checked(y * frame.Stride)), row, 0, widthBytes);
                        if (frame.FourCC == Bgrx) for (int x = 3; x < widthBytes; x += 4) row[x] = 255;
                        Marshal.Copy(row, 0, IntPtr.Add(data.Scan0, checked(y * data.Stride)), widthBytes);
                    }
                }
                finally { bitmap.UnlockBits(data); }
                bitmap.Save(temporary, ImageFormat.Png);
            }
            if (File.Exists(target))
            {
                Require((File.GetAttributes(target) & FileAttributes.ReparsePoint) == 0, "EVIDENCE_PATH");
                File.Delete(target);
            }
            File.Move(temporary, target);
        }
        catch (ProbeFailure) { throw; }
        catch { throw new ProbeFailure("EVIDENCE_WRITE"); }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
    }
    private static Dictionary<string, object> Frame(string name, int[] expected, int minFrames, int minDurationMs, int timeoutMs)
    {
        Require(Receiver != IntPtr.Zero, "RECEIVER_REQUIRED");
        Stopwatch watch = Stopwatch.StartNew(); long firstMatch = -1; int matched = 0;
        HashSet<long> timestamps = new HashSet<long>();
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            CheckDeadline(); VideoFrame frame = new VideoFrame();
            int type = CaptureVideo(Receiver, ref frame, IntPtr.Zero, IntPtr.Zero, 100);
            if (type != Video)
            {
                // Initial connection/reconnect may notify an error before the
                // stream becomes available. It never counts as a valid frame.
                if (type == 4) { matched = 0; firstMatch = -1; timestamps.Clear(); continue; }
                if (type != 0 && type != 100) throw new ProbeFailure("CAPTURE_TYPE_" + type.ToString());
                continue;
            }
            try
            {
                ValidateFrame(frame);
                if (!PixelsMatch(frame, expected)) { matched = 0; firstMatch = -1; timestamps.Clear(); continue; }
                if (!timestamps.Add(frame.Timestamp)) continue;
                Require(timestamps.Count <= 512, "VIDEO_FRAME_LIMIT");
                matched++; if (firstMatch < 0) firstMatch = watch.ElapsedMilliseconds;
                if (matched >= minFrames && watch.ElapsedMilliseconds - firstMatch >= minDurationMs)
                {
                    Require(GetConnections(Receiver) > 0, "RECEIVER_DISCONNECTED");
                    SavePng(frame, name);
                    Dictionary<string, object> result = Stats();
                    result["matchedFrames"] = matched; result["distinctTimestamps"] = timestamps.Count;
                    result["sampleDurationMs"] = watch.ElapsedMilliseconds - firstMatch;
                    result["format"] = frame.FourCC == Bgra ? "BGRA" : "BGRX";
                    result["width"] = frame.Width; result["height"] = frame.Height;
                    result["frameRateN"] = frame.FrameN; result["frameRateD"] = frame.FrameD;
                    return result;
                }
            }
            finally { ReleaseVideo(Receiver, ref frame); }
        }
        throw new ProbeFailure("FRAME_TIMEOUT");
    }
    private static Dictionary<string, object> Quiet(int durationMs, int timeoutMs)
    {
        Require(Receiver != IntPtr.Zero, "RECEIVER_REQUIRED");
        Stopwatch watch = Stopwatch.StartNew(); long quietSince = -1; int drained = 0;
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            CheckDeadline(); VideoFrame frame = new VideoFrame();
            int type = CaptureVideo(Receiver, ref frame, IntPtr.Zero, IntPtr.Zero, 100);
            if (type == Video)
            {
                try { drained++; } finally { ReleaseVideo(Receiver, ref frame); }
                quietSince = -1; continue;
            }
            // A connection-lost notification is not video silence. Reset the
            // observation and require a subsequent healthy none/status interval.
            if (type == 4) { quietSince = -1; continue; }
            if (type != 0 && type != 100) throw new ProbeFailure("CAPTURE_TYPE_" + type.ToString());
            if (GetConnections(Receiver) != 0) { quietSince = -1; continue; }
            if (quietSince < 0) quietSince = watch.ElapsedMilliseconds;
            if (watch.ElapsedMilliseconds - quietSince >= durationMs)
            {
                Dictionary<string, object> result = Stats(); result["drainedFrames"] = drained;
                result["quietDurationMs"] = watch.ElapsedMilliseconds - quietSince; return result;
            }
        }
        throw new ProbeFailure("QUIET_TIMEOUT");
    }
    private static int Number(Dictionary<string, object> request, string key, int minimum, int maximum, int fallback)
    {
        object value; if (!request.TryGetValue(key, out value)) return fallback;
        Require(value is int, "INVALID_REQUEST"); int integer = (int)value;
        Require(integer >= minimum && integer <= maximum, "INVALID_REQUEST"); return integer;
    }
    private static bool TokenMatches(string candidate)
    {
        if (candidate == null || candidate.Length != Token.Length) return false;
        int mismatch = 0; for (int i = 0; i < candidate.Length; i++) mismatch |= candidate[i] ^ Token[i]; return mismatch == 0;
    }
    private static void Keys(Dictionary<string, object> request, params string[] allowed)
    {
        HashSet<string> accepted = new HashSet<string>(allowed, StringComparer.Ordinal);
        foreach (string key in request.Keys) Require(accepted.Contains(key), "INVALID_REQUEST");
    }
    private static Dictionary<string, object> Execute(Dictionary<string, object> request, out bool close)
    {
        close = false; object raw;
        Require(request.TryGetValue("token", out raw) && raw is string && TokenMatches((string)raw), "UNAUTHORIZED");
        Require(request.TryGetValue("command", out raw) && raw is string, "INVALID_REQUEST"); string command = (string)raw;
        if (command == "absent")
        {
            Keys(request, "token", "id", "command", "durationMs"); Absent(Number(request, "durationMs", 100, 3000, 1000)); return Stats();
        }
        if (command == "discover")
        {
            Keys(request, "token", "id", "command", "timeoutMs"); Discover(Number(request, "timeoutMs", 100, 30000, 15000)); return Stats();
        }
        if (command == "frame")
        {
            Keys(request, "token", "id", "command", "name", "rgb", "minFrames", "minDurationMs", "timeoutMs");
            Require(request.TryGetValue("name", out raw) && raw is string && Regex.IsMatch((string)raw, "^[a-z0-9-]{1,48}$"), "INVALID_REQUEST"); string name = (string)raw;
            Require(request.TryGetValue("rgb", out raw) && raw is IList, "INVALID_REQUEST"); IList rgb = (IList)raw;
            Require(rgb.Count == 3, "INVALID_REQUEST"); int[] expected = new int[3];
            for (int i = 0; i < 3; i++) { Require(rgb[i] is int && (int)rgb[i] >= 0 && (int)rgb[i] <= 255, "INVALID_REQUEST"); expected[i] = (int)rgb[i]; }
            int duration = Number(request, "minDurationMs", 0, 3000, 0), timeout = Number(request, "timeoutMs", 100, 20000, 10000);
            Require(timeout >= duration, "INVALID_REQUEST");
            return Frame(name, expected, Number(request, "minFrames", 1, 120, 3), duration, timeout);
        }
        if (command == "quiet")
        {
            Keys(request, "token", "id", "command", "durationMs", "timeoutMs");
            int duration = Number(request, "durationMs", 1500, 3000, 1500), timeout = Number(request, "timeoutMs", 1500, 20000, 20000);
            Require(timeout >= duration, "INVALID_REQUEST"); return Quiet(duration, timeout);
        }
        if (command == "close") { Keys(request, "token", "id", "command"); close = true; return Stats(); }
        throw new ProbeFailure("UNKNOWN_COMMAND");
    }
    private static string ReadRequest(NetworkStream stream)
    {
        stream.ReadTimeout = 2000; List<byte> bytes = new List<byte>(256);
        while (bytes.Count <= 4096)
        {
            CheckDeadline(); int value;
            try { value = stream.ReadByte(); } catch { throw new ProbeFailure("REQUEST_TIMEOUT"); }
            Require(value >= 0, "REQUEST_CLOSED");
            if (value == 10)
            {
                if (bytes.Count > 0 && bytes[bytes.Count - 1] == 13) bytes.RemoveAt(bytes.Count - 1);
                Require(bytes.Count > 0, "INVALID_REQUEST");
                try { return Utf8.GetString(bytes.ToArray()); } catch { throw new ProbeFailure("INVALID_JSON"); }
            }
            bytes.Add((byte)value);
        }
        throw new ProbeFailure("REQUEST_LIMIT");
    }
    private static void Reply(NetworkStream stream, Dictionary<string, object> result)
    {
        byte[] bytes = Utf8.GetBytes(Json.Serialize(result) + "\n"); Require(bytes.Length <= 4096, "REPLY_LIMIT");
        stream.WriteTimeout = 2000; stream.Write(bytes, 0, bytes.Length);
    }
    private static string LocalPath(string value)
    {
        Require(!String.IsNullOrEmpty(value) && Path.IsPathRooted(value) && !value.StartsWith("\\\\", StringComparison.Ordinal) && !value.StartsWith("//", StringComparison.Ordinal), "INVALID_ARGS");
        return Path.GetFullPath(value);
    }
    private static bool Cleanup()
    {
        bool success = true;
        if (Receiver != IntPtr.Zero) { try { RecvDestroy(Receiver); } catch { success = false; } Receiver = IntPtr.Zero; }
        if (Finder != IntPtr.Zero) { try { FindDestroy(Finder); } catch { success = false; } Finder = IntPtr.Zero; }
        if (NameMemory != IntPtr.Zero) { Marshal.FreeHGlobal(NameMemory); NameMemory = IntPtr.Zero; }
        if (ReceiverNameMemory != IntPtr.Zero) { Marshal.FreeHGlobal(ReceiverNameMemory); ReceiverNameMemory = IntPtr.Zero; }
        if (Initialized) { try { NdiDestroy(); } catch { success = false; } Initialized = false; }
        if (Library != IntPtr.Zero) { if (!FreeLibrary(Library)) success = false; Library = IntPtr.Zero; }
        return success;
    }
    private static int Main(string[] args)
    {
        TcpListener listener = null; int exit = 0;
        try
        {
            Console.OutputEncoding = Utf8;
            Require(args.Length == 3, "INVALID_ARGS"); string dll = LocalPath(args[0]); TargetLabel = args[1]; EvidenceDirectory = LocalPath(args[2]);
            Require(File.Exists(dll) && String.Equals(Path.GetFileName(dll), "Processing.NDI.Lib.x64.dll", StringComparison.OrdinalIgnoreCase), "RUNTIME_PATH");
            Require(!String.IsNullOrWhiteSpace(TargetLabel) && TargetLabel.Length <= 64, "INVALID_ARGS");
            foreach (char c in TargetLabel) Require(c >= 32 && c <= 126, "INVALID_ARGS");
            Token = Environment.GetEnvironmentVariable("PIRAIDERS_NDI_PROBE_TOKEN");
            Require(Token != null && Regex.IsMatch(Token, "^[A-Za-z0-9_-]{32,128}$"), "TOKEN_REQUIRED");
            Directory.CreateDirectory(EvidenceDirectory); Require((File.GetAttributes(EvidenceDirectory) & FileAttributes.ReparsePoint) == 0, "EVIDENCE_PATH");
            string version = Initialize(dll);
            listener = new TcpListener(IPAddress.Loopback, 0); listener.Start(4);
            Console.WriteLine(Json.Serialize(new Dictionary<string, object> {
                { "event", "ndi-probe-ready" }, { "port", ((IPEndPoint)listener.LocalEndpoint).Port }, { "runtimeVersion", version }, { "abiValid", true }
            }));
            bool close = false;
            while (!close)
            {
                CheckDeadline(); if (!listener.Pending()) { Thread.Sleep(20); continue; }
                using (TcpClient client = listener.AcceptTcpClient())
                {
                    client.NoDelay = true; int id = 0; Dictionary<string, object> response;
                    try
                    {
                        object decoded;
                        try { decoded = Json.DeserializeObject(ReadRequest(client.GetStream())); } catch (ProbeFailure) { throw; } catch { throw new ProbeFailure("INVALID_JSON"); }
                        Dictionary<string, object> request = decoded as Dictionary<string, object>; Require(request != null, "INVALID_REQUEST");
                        id = Number(request, "id", 1, Int32.MaxValue, 0); Require(id > 0, "INVALID_REQUEST");
                        response = Execute(request, out close); response["id"] = id; response["ok"] = true;
                    }
                    catch (ProbeFailure error) { response = new Dictionary<string, object> { { "id", id }, { "ok", false }, { "code", error.Code } }; }
                    catch { response = new Dictionary<string, object> { { "id", id }, { "ok", false }, { "code", "PROBE_COMMAND_FAILED" } }; }
                    try { Reply(client.GetStream(), response); } catch { /* A caller disconnect cannot escape cleanup or print credentials. */ }
                }
            }
        }
        catch (ProbeFailure error) { Console.Error.WriteLine("NDI_PROBE_FAILED_" + error.Code); exit = 1; }
        catch { Console.Error.WriteLine("NDI_PROBE_FAILED"); exit = 1; }
        finally
        {
            try { if (listener != null) listener.Stop(); } catch { Console.Error.WriteLine("NDI_PROBE_FAILED_CLEANUP"); exit = 1; }
            try { if (!Cleanup()) { Console.Error.WriteLine("NDI_PROBE_FAILED_CLEANUP"); exit = 1; } }
            catch { Console.Error.WriteLine("NDI_PROBE_FAILED_CLEANUP"); exit = 1; }
        }
        return exit;
    }
}
