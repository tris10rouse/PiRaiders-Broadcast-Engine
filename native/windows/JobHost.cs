// PiRaiders Broadcast Engine - MIT licensed; see repository LICENSE.
// Windows-only containment boundary. The Node launcher owns this host's stdin
// pipe; child stdin is NUL and only its output handles are inherited.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class JobHost
{
    private const uint KillOnJobClose = 0x00002000;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateNoWindow = 0x08000000;
    private const uint ExtendedStartupInfoPresent = 0x00080000;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint DuplicateSameAccess = 0x00000002;
    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint OpenExisting = 3;
    private const uint WaitObject0 = 0;
    private const uint WaitTimeout = 258;
    private const int FailureExitCode = 252;
    private static int parentGone;

    private static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool assigned = false;
        try
        {
            if (args.Length < 1 || !IsAbsolutePath(args[0]) || !File.Exists(args[0]))
                throw new ArgumentException("An existing absolute target executable is required");
            for (int i = 0; i < args.Length; i++)
                if (args[i].IndexOf('\0') >= 0) throw new ArgumentException("NUL is not a valid argument");

            // No SECURITY_ATTRIBUTES: this unnamed job handle is not inheritable.
            job = CreateJobObjectW(IntPtr.Zero, null);
            RequireHandle(job, "CreateJobObject");
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
            int limitSize = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr limitData = Marshal.AllocHGlobal(limitSize);
            try
            {
                Marshal.StructureToPtr(limits, limitData, false);
                Require(SetInformationJobObject(job, 9, limitData, (uint)limitSize), "SetInformationJobObject");
            }
            finally { Marshal.FreeHGlobal(limitData); }

            // Start watching before child creation. Reading a parent-owned pipe
            // detects abrupt launcher death as well as deliberate stdin close.
            Thread lifetime = new Thread(WatchParent);
            lifetime.IsBackground = true;
            lifetime.Start();
            if (Interlocked.CompareExchange(ref parentGone, 0, 0) != 0) return FailureExitCode;

            using (InheritedHandles handles = new InheritedHandles())
            {
                STARTUPINFOEX startup = handles.Startup;
                StringBuilder commandLine = new StringBuilder();
                for (int i = 0; i < args.Length; i++)
                {
                    if (i != 0) commandLine.Append(' ');
                    commandLine.Append(QuoteArgument(args[i]));
                }
                if (commandLine.Length >= 32767) throw new ArgumentException("Target command line exceeds Windows limit");
                // lpApplicationName is explicit. Never invoke a shell, search
                // PATH, or let target code run before job assignment succeeds.
                Require(CreateProcessW(args[0], commandLine, IntPtr.Zero, IntPtr.Zero, true,
                    CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent,
                    IntPtr.Zero, null, ref startup, out process), "CreateProcess");
            }
            Require(AssignProcessToJobObject(job, process.hProcess), "AssignProcessToJobObject");
            assigned = true;
            if (Interlocked.CompareExchange(ref parentGone, 0, 0) != 0)
            {
                StopJobAndWait(job, (uint)FailureExitCode);
                return FailureExitCode;
            }
            if (ResumeThread(process.hThread) == UInt32.MaxValue) ThrowWin32("ResumeThread");
            CloseHandle(process.hThread);
            process.hThread = IntPtr.Zero;

            while (true)
            {
                if (Interlocked.CompareExchange(ref parentGone, 0, 0) != 0)
                {
                    StopJobAndWait(job, (uint)FailureExitCode);
                    return FailureExitCode;
                }
                uint wait = WaitForSingleObject(process.hProcess, 50);
                if (wait == WaitTimeout) continue;
                if (wait != WaitObject0) ThrowWin32("WaitForSingleObject");
                uint exitCode;
                Require(GetExitCodeProcess(process.hProcess, out exitCode), "GetExitCodeProcess");
                // Root death is not sufficient: descendants must be gone before
                // the supervisor receives exit and is allowed to restart.
                StopJobAndWait(job, exitCode);
                return unchecked((int)exitCode);
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("PiRaiders JobHost failed: " + error.Message);
            return FailureExitCode;
        }
        finally
        {
            if (process.hProcess != IntPtr.Zero)
            {
                // In particular, assignment failure must never leave a suspended
                // root process alive outside containment.
                if (!assigned)
                {
                    if (!TerminateProcess(process.hProcess, (uint)FailureExitCode))
                        Console.Error.WriteLine("PiRaiders JobHost: failed to terminate unassigned suspended root (Win32 " + Marshal.GetLastWin32Error() + ")");
                    else if (WaitForSingleObject(process.hProcess, 5000) != WaitObject0)
                        Console.Error.WriteLine("PiRaiders JobHost: unassigned root termination is unconfirmed");
                }
                CloseHandle(process.hProcess);
            }
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            // Last-handle close is the kernel fallback on every error path.
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }

    private static void WatchParent()
    {
        try
        {
            Stream input = Console.OpenStandardInput();
            while (input.ReadByte() != -1) { }
        }
        catch { /* A broken or unreadable lifetime pipe is also parent loss. */ }
        finally { Interlocked.Exchange(ref parentGone, 1); }
    }

    private static void StopJobAndWait(IntPtr job, uint code)
    {
        Require(TerminateJobObject(job, code), "TerminateJobObject");
        Stopwatch elapsed = Stopwatch.StartNew();
        while (true)
        {
            JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
            uint returned;
            Require(QueryInformationJobObject(job, 1, out accounting,
                (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), out returned), "QueryInformationJobObject");
            if (accounting.ActiveProcesses == 0) return;
            if (elapsed.ElapsedMilliseconds >= 5000) throw new TimeoutException("Job process termination remains unconfirmed after 5 seconds");
            Thread.Sleep(10);
        }
    }

    // Windows CommandLineToArgvW/CRT quoting: each trailing backslash is doubled
    // before the closing quote, and backslashes before a quote are doubled plus
    // one. Quoting every argument also preserves empty strings and whitespace.
    private static string QuoteArgument(string value)
    {
        StringBuilder quoted = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') quoted.Append('\\', slashes * 2 + 1).Append('"');
            else quoted.Append('\\', slashes).Append(c);
            slashes = 0;
        }
        return quoted.Append('\\', slashes * 2).Append('"').ToString();
    }

    private static bool IsAbsolutePath(string value)
    {
        // Path.IsPathRooted also accepts drive-relative C:foo and \foo.
        // Targets must instead have a drive+root or an absolute UNC/device path.
        return (value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':' &&
            (value[2] == '\\' || value[2] == '/')) || value.StartsWith("\\\\", StringComparison.Ordinal);
    }

    private static void Require(bool success, string operation) { if (!success) ThrowWin32(operation); }
    private static void RequireHandle(IntPtr handle, string operation)
    {
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) ThrowWin32(operation);
    }
    private static void ThrowWin32(string operation)
    {
        int code = Marshal.GetLastWin32Error();
        throw new Win32Exception(code, operation + " failed (Win32 " + code + ")");
    }

    // Restrict inheritance to three explicit handles. The lifetime pipe and job
    // must never leak into the target or its descendants.
    private sealed class InheritedHandles : IDisposable
    {
        public STARTUPINFOEX Startup;
        private IntPtr input;
        private IntPtr output;
        private IntPtr error;
        private IntPtr attributeList;
        private IntPtr handleList;
        private bool initialized;

        public InheritedHandles()
        {
            try
            {
                input = OpenNull(GenericRead);
                output = CopyOutput(-11);
                error = CopyOutput(-12);
                IntPtr size = IntPtr.Zero;
                InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                if (size == IntPtr.Zero) ThrowWin32("InitializeProcThreadAttributeList size");
                attributeList = Marshal.AllocHGlobal(size);
                Require(InitializeProcThreadAttributeList(attributeList, 1, 0, ref size), "InitializeProcThreadAttributeList");
                initialized = true;
                handleList = Marshal.AllocHGlobal(IntPtr.Size * 3);
                Marshal.WriteIntPtr(handleList, 0, input);
                Marshal.WriteIntPtr(handleList, IntPtr.Size, output);
                Marshal.WriteIntPtr(handleList, IntPtr.Size * 2, error);
                Require(UpdateProcThreadAttribute(attributeList, 0, new IntPtr(0x00020002), handleList,
                    new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero), "UpdateProcThreadAttribute handle list");
                Startup = new STARTUPINFOEX();
                Startup.StartupInfo.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFOEX));
                Startup.StartupInfo.dwFlags = StartfUseStdHandles;
                Startup.StartupInfo.hStdInput = input;
                Startup.StartupInfo.hStdOutput = output;
                Startup.StartupInfo.hStdError = error;
                Startup.lpAttributeList = attributeList;
            }
            catch { Dispose(); throw; }
        }
        private static IntPtr OpenNull(uint access)
        {
            SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES();
            security.nLength = (uint)Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            security.bInheritHandle = true;
            IntPtr handle = CreateFileW("NUL", access, 3, ref security, OpenExisting, 0, IntPtr.Zero);
            RequireHandle(handle, "CreateFile NUL");
            return handle;
        }
        private static IntPtr CopyOutput(int kind)
        {
            IntPtr source = GetStdHandle(kind);
            if (source == IntPtr.Zero || source == new IntPtr(-1)) return OpenNull(GenericWrite);
            IntPtr copy;
            IntPtr self = GetCurrentProcess();
            Require(DuplicateHandle(self, source, self, out copy, 0, true, DuplicateSameAccess), "DuplicateHandle output");
            return copy;
        }
        public void Dispose()
        {
            if (initialized) { DeleteProcThreadAttributeList(attributeList); initialized = false; }
            if (attributeList != IntPtr.Zero) { Marshal.FreeHGlobal(attributeList); attributeList = IntPtr.Zero; }
            if (handleList != IntPtr.Zero) { Marshal.FreeHGlobal(handleList); handleList = IntPtr.Zero; }
            if (input != IntPtr.Zero) { CloseHandle(input); input = IntPtr.Zero; }
            if (output != IntPtr.Zero) { CloseHandle(output); output = IntPtr.Zero; }
            if (error != IntPtr.Zero) { CloseHandle(error); error = IntPtr.Zero; }
        }
    }

    [StructLayout(LayoutKind.Sequential)] private struct SECURITY_ATTRIBUTES
    { public uint nLength; public IntPtr lpSecurityDescriptor; [MarshalAs(UnmanagedType.Bool)] public bool bInheritHandle; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct STARTUPINFO
    {
        public uint cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public uint dwX; public uint dwY; public uint dwXSize; public uint dwYSize;
        public uint dwXCountChars; public uint dwYCountChars; public uint dwFillAttribute;
        public uint dwFlags; public ushort wShowWindow; public ushort cbReserved2;
        public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] private struct STARTUPINFOEX
    { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] private struct PROCESS_INFORMATION
    { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit; public long PerJobUserTimeLimit; public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize; public UIntPtr MaximumWorkingSetSize; public uint ActiveProcessLimit;
        public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IO_COUNTERS
    { public ulong ReadOperationCount; public ulong WriteOperationCount; public ulong OtherOperationCount; public ulong ReadTransferCount; public ulong WriteTransferCount; public ulong OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit; public UIntPtr JobMemoryLimit; public UIntPtr PeakProcessMemoryUsed; public UIntPtr PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)] private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr data, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION data, uint length, out uint returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)] private static extern IntPtr CreateFileW(string path, uint access, uint sharing, ref SECURITY_ATTRIBUTES attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previousValue, IntPtr returnSize);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
}
