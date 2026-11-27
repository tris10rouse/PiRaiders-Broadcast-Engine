// PiRaiders Broadcast Engine - MIT licensed; see repository LICENSE.
// Q-019: answers whether this PC's graphics driver gives OpenGL 4.5, so the
// app can choose the graphics card or the bundled software renderer. Shipped
// in the Windows bundle as app\build\windows\PiRaiders.GraphicsCheck.exe and
// run by Setup and Diagnose (scripts/lib/graphics-check.cjs).
//
// It loads only the system's opengl32.dll (LOAD_LIBRARY_SEARCH_SYSTEM32),
// never the bundled Mesa copy, opens a hidden 16x16 window, makes a plain
// OpenGL context, then asks the driver for a 4.5 core context. It prints
// exactly one line and nothing else, ever:
//   GPU_OPENGL_45        the driver made a 4.5 context and reports 4.5 or later
//   GPU_OPENGL_TOO_OLD   the driver refused 4.5 and reports an older version
//   GPU_OPENGL_UNKNOWN   anything else (no window, no pixel format, no context,
//                        an answer that does not add up, any exception)
// It never reads or prints the GPU's name, vendor or driver path. Exit 0.
using System;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

internal static class GraphicsCheck
{
    private const string Gl45 = "GPU_OPENGL_45";
    private const string TooOld = "GPU_OPENGL_TOO_OLD";
    private const string Unknown = "GPU_OPENGL_UNKNOWN";
    private const uint LOAD_LIBRARY_SEARCH_SYSTEM32 = 0x00000800;
    private const uint SEM_FAILCRITICALERRORS = 0x0001, SEM_NOGPFAULTERRORBOX = 0x0002;
    private const uint CS_OWNDC = 0x0020;
    private const uint WS_POPUP = 0x80000000, WS_CLIPSIBLINGS = 0x04000000, WS_CLIPCHILDREN = 0x02000000;
    private const uint PFD_DOUBLEBUFFER = 0x01, PFD_DRAW_TO_WINDOW = 0x04, PFD_SUPPORT_OPENGL = 0x20;
    private const uint GL_VERSION = 0x1F02, GL_MAJOR_VERSION = 0x821B, GL_MINOR_VERSION = 0x821C;
    private const int WGL_CONTEXT_MAJOR_VERSION_ARB = 0x2091, WGL_CONTEXT_MINOR_VERSION_ARB = 0x2092;
    private const int WGL_CONTEXT_PROFILE_MASK_ARB = 0x9126, WGL_CONTEXT_CORE_PROFILE_BIT_ARB = 0x0001;
    private const string ClassName = "PiRaidersGraphicsCheck";

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSEXW
    {
        public uint cbSize; public uint style; public IntPtr lpfnWndProc; public int cbClsExtra; public int cbWndExtra;
        public IntPtr hInstance; public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszMenuName;
        [MarshalAs(UnmanagedType.LPWStr)] public string lpszClassName;
        public IntPtr hIconSm;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PIXELFORMATDESCRIPTOR
    {
        public ushort nSize, nVersion; public uint dwFlags;
        public byte iPixelType, cColorBits, cRedBits, cRedShift, cGreenBits, cGreenShift, cBlueBits, cBlueShift,
            cAlphaBits, cAlphaShift, cAccumBits, cAccumRedBits, cAccumGreenBits, cAccumBlueBits, cAccumAlphaBits,
            cDepthBits, cStencilBits, cAuxBuffers, iLayerType, bReserved;
        public uint dwLayerMask, dwVisibleMask, dwDamageMask;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate IntPtr CreateContextAttribsArb(IntPtr dc, IntPtr share, int[] attributes);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadLibraryExW(string name, IntPtr file, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandleW(string name);
    [DllImport("kernel32.dll", CharSet = CharSet.Ansi, ExactSpelling = true)] private static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll")] private static extern uint SetErrorMode(uint mode);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClassExW(ref WNDCLASSEXW windowClass);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowExW(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetDC(IntPtr window);
    [DllImport("user32.dll")] private static extern int ReleaseDC(IntPtr window, IntPtr dc);
    [DllImport("gdi32.dll")] private static extern int ChoosePixelFormat(IntPtr dc, ref PIXELFORMATDESCRIPTOR descriptor);
    [DllImport("gdi32.dll")] private static extern bool SetPixelFormat(IntPtr dc, int format, ref PIXELFORMATDESCRIPTOR descriptor);
    // Resolved against the opengl32.dll already loaded from System32 above.
    [DllImport("opengl32.dll")] private static extern IntPtr wglCreateContext(IntPtr dc);
    [DllImport("opengl32.dll")] private static extern bool wglMakeCurrent(IntPtr dc, IntPtr context);
    [DllImport("opengl32.dll")] private static extern bool wglDeleteContext(IntPtr context);
    [DllImport("opengl32.dll", CharSet = CharSet.Ansi)] private static extern IntPtr wglGetProcAddress(string name);
    [DllImport("opengl32.dll")] private static extern IntPtr glGetString(uint name);
    [DllImport("opengl32.dll")] private static extern void glGetIntegerv(uint name, out int value);

    private static int Main()
    {
        string answer;
        try { SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX); answer = Check(); }
        catch (Exception) { answer = Unknown; }
        if (answer != Gl45 && answer != TooOld) answer = Unknown;
        Console.WriteLine(answer);
        return 0;
    }

    private static bool AtLeast45(int major, int minor) { return major > 4 || (major == 4 && minor >= 5); }

    // wglGetProcAddress answers 0, 1, 2, 3 or -1 for a missing function on some drivers.
    private static bool Usable(IntPtr function)
    {
        long value = function.ToInt64();
        return value != 0 && value != 1 && value != 2 && value != 3 && value != -1;
    }

    // The plain context's "major.minor" from GL_VERSION; the rest of the string is never kept.
    private static bool PlainVersion(out int major, out int minor)
    {
        major = 0; minor = 0;
        IntPtr text = glGetString(GL_VERSION);
        if (text == IntPtr.Zero) return false;
        Match match = Regex.Match(Marshal.PtrToStringAnsi(text) ?? "", "^([0-9]{1,3})\\.([0-9]{1,3})");
        if (!match.Success) return false;
        major = int.Parse(match.Groups[1].Value); minor = int.Parse(match.Groups[2].Value);
        return true;
    }

    private static string Check()
    {
        if (LoadLibraryExW("opengl32.dll", IntPtr.Zero, LOAD_LIBRARY_SEARCH_SYSTEM32) == IntPtr.Zero) return Unknown;
        IntPtr instance = GetModuleHandleW(null);
        IntPtr defaultProcedure = GetProcAddress(GetModuleHandleW("user32.dll"), "DefWindowProcW");
        if (defaultProcedure == IntPtr.Zero) return Unknown;
        WNDCLASSEXW windowClass = new WNDCLASSEXW();
        windowClass.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEXW));
        windowClass.style = CS_OWNDC; windowClass.lpfnWndProc = defaultProcedure; windowClass.hInstance = instance;
        windowClass.lpszClassName = ClassName;
        if (RegisterClassExW(ref windowClass) == 0) return Unknown;
        IntPtr window = CreateWindowExW(0, ClassName, "", WS_POPUP | WS_CLIPSIBLINGS | WS_CLIPCHILDREN, 0, 0, 16, 16,
            IntPtr.Zero, IntPtr.Zero, instance, IntPtr.Zero);
        if (window == IntPtr.Zero) return Unknown;
        IntPtr dc = IntPtr.Zero, plain = IntPtr.Zero, modern = IntPtr.Zero;
        try
        {
            dc = GetDC(window);
            if (dc == IntPtr.Zero) return Unknown;
            PIXELFORMATDESCRIPTOR descriptor = new PIXELFORMATDESCRIPTOR();
            descriptor.nSize = (ushort)Marshal.SizeOf(typeof(PIXELFORMATDESCRIPTOR)); descriptor.nVersion = 1;
            descriptor.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
            descriptor.cColorBits = 32; descriptor.cDepthBits = 24;
            int format = ChoosePixelFormat(dc, ref descriptor);
            if (format == 0 || !SetPixelFormat(dc, format, ref descriptor)) return Unknown;
            plain = wglCreateContext(dc);
            if (plain == IntPtr.Zero || !wglMakeCurrent(dc, plain)) return Unknown;
            int major, minor;
            bool known = PlainVersion(out major, out minor);
            IntPtr create = wglGetProcAddress("wglCreateContextAttribsARB");
            if (!Usable(create))
            {
                // No way to ask for 4.5: the plain context's version decides.
                if (!known) return Unknown;
                return AtLeast45(major, minor) ? Gl45 : TooOld;
            }
            CreateContextAttribsArb createContext = (CreateContextAttribsArb)Marshal.GetDelegateForFunctionPointer(create, typeof(CreateContextAttribsArb));
            int[] attributes = { WGL_CONTEXT_MAJOR_VERSION_ARB, 4, WGL_CONTEXT_MINOR_VERSION_ARB, 5,
                WGL_CONTEXT_PROFILE_MASK_ARB, WGL_CONTEXT_CORE_PROFILE_BIT_ARB, 0 };
            modern = createContext(dc, IntPtr.Zero, attributes);
            if (modern == IntPtr.Zero)
            {
                // The driver refused 4.5; it is too old only if it also says so.
                return known && !AtLeast45(major, minor) ? TooOld : Unknown;
            }
            if (!wglMakeCurrent(dc, modern)) return Unknown;
            int modernMajor, modernMinor;
            glGetIntegerv(GL_MAJOR_VERSION, out modernMajor);
            glGetIntegerv(GL_MINOR_VERSION, out modernMinor);
            return AtLeast45(modernMajor, modernMinor) ? Gl45 : Unknown;
        }
        finally
        {
            if (plain != IntPtr.Zero || modern != IntPtr.Zero) wglMakeCurrent(IntPtr.Zero, IntPtr.Zero);
            if (modern != IntPtr.Zero) wglDeleteContext(modern);
            if (plain != IntPtr.Zero) wglDeleteContext(plain);
            if (dc != IntPtr.Zero) ReleaseDC(window, dc);
            DestroyWindow(window);
        }
    }
}
