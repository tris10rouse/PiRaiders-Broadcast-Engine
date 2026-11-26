// PiRaiders Broadcast Engine - MIT licensed; see repository LICENSE.
// CI proof helper only (5d-2); never shipped in the Windows bundle. It runs a
// command in a console of its own, the way Launch-PiRaiders.cmd runs in the
// operator's console window, and later presses Ctrl+C in that console or
// closes its window, the way the operator would.
//
//   start <exe> [args...]  runs <exe> in a new, hidden console. This helper's
//                          stdin, stdout and stderr are the command's; it waits
//                          and exits with the command's exit code once nothing
//                          the command started is still running (246 if
//                          something still runs 10 s after the command ended).
//                          The command is in a kill-on-close job, so ending
//                          this helper ends the command and everything it started.
//   ctrl-c <pid>           sends CTRL_C_EVENT to every process on <pid>'s console.
//   close <pid>            posts WM_CLOSE to <pid>'s console window, as its X
//                          button does: Windows sends CTRL_CLOSE_EVENT to every
//                          process on that console and ends them shortly after.
//
// Exit codes of the helper itself: 0 done (or, for start, the command's code),
// 240 usage, 241 attach, 242 Ctrl+C, 243 no console window, 244 close, 245 start,
// 246 a process the command started outlived it.
using System;
using System.Runtime.InteropServices;
using System.Text;

internal static class ConsoleProof
{
    private const uint CreateNewConsole = 0x00000010;
    private const uint CreateSuspended = 0x00000004;
    private const uint CreateUnicodeEnvironment = 0x00000400;
    private const uint StartfUseShowWindow = 0x00000001;
    private const uint StartfUseStdHandles = 0x00000100;
    private const uint KillOnJobClose = 0x00002000;
    private const uint DuplicateSameAccess = 0x00000002;
    private const uint CtrlCEvent = 0;
    private const uint WmClose = 0x0010;
    private const uint Infinite = 0xFFFFFFFF;

    private static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "start") return Start(args);
        uint pid;
        if (args.Length != 2 || !UInt32.TryParse(args[1], System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture, out pid) || pid == 0) return 240;
        if (args[0] == "ctrl-c") return CtrlC(pid);
        if (args[0] == "close") return Close(pid);
        return 240;
    }

    private static int CtrlC(uint pid)
    {
        FreeConsole();
        if (!AttachConsole(pid)) return 241;
        // This helper is now on the target console too; it must not end itself.
        SetConsoleCtrlHandler(IntPtr.Zero, true);
        bool sent = GenerateConsoleCtrlEvent(CtrlCEvent, 0);
        FreeConsole();
        return sent ? 0 : 242;
    }

    private static int Close(uint pid)
    {
        FreeConsole();
        if (!AttachConsole(pid)) return 241;
        IntPtr window = GetConsoleWindow();
        // Leave the console before closing it, so the close event does not end this helper.
        FreeConsole();
        if (window == IntPtr.Zero) return 243;
        return PostMessageW(window, WmClose, IntPtr.Zero, IntPtr.Zero) ? 0 : 244;
    }

    private static int Start(string[] args)
    {
        try
        {
            // The new console's first process inherits the Ctrl+C state: keep it enabled.
            SetConsoleCtrlHandler(IntPtr.Zero, false);
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return 245;
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = KillOnJobClose;
            int size = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr block = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(limits, block, false);
                if (!SetInformationJobObject(job, 9, block, (uint)size)) return 245;
            }
            finally { Marshal.FreeHGlobal(block); }

            StringBuilder commandLine = new StringBuilder();
            for (int i = 1; i < args.Length; i++)
            {
                if (i > 1) commandLine.Append(' ');
                commandLine.Append(QuoteArgument(args[i]));
            }
            STARTUPINFO startup = new STARTUPINFO();
            startup.cb = (uint)Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = StartfUseStdHandles | StartfUseShowWindow;
            startup.wShowWindow = 0; // SW_HIDE: a real console window, not shown on the CI desktop
            startup.hStdInput = Inheritable(GetStdHandle(-10));
            startup.hStdOutput = Inheritable(GetStdHandle(-11));
            startup.hStdError = Inheritable(GetStdHandle(-12));
            PROCESS_INFORMATION process;
            if (!CreateProcessW(args[1], commandLine, IntPtr.Zero, IntPtr.Zero, true,
                CreateNewConsole | CreateSuspended | CreateUnicodeEnvironment, IntPtr.Zero, null, ref startup, out process)) return 245;
            if (!AssignProcessToJobObject(job, process.hProcess))
            {
                TerminateProcess(process.hProcess, 245);
                return 245;
            }
            ResumeThread(process.hThread);
            CloseHandle(process.hThread);
            WaitForSingleObject(process.hProcess, Infinite);
            uint code;
            if (!GetExitCodeProcess(process.hProcess, out code)) return 245;
            // The job still holds anything the command left behind; this helper's
            // exit would end it, so report it instead of hiding it.
            for (int waited = 0; ; waited += 100)
            {
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
                uint length;
                if (!QueryInformationJobObject(job, 1, out accounting, (uint)Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), out length)) return 245;
                if (accounting.ActiveProcesses == 0) break;
                if (waited >= 10000) return 246;
                System.Threading.Thread.Sleep(100);
            }
            return unchecked((int)code);
        }
        catch (Exception)
        {
            return 245;
        }
    }

    private static IntPtr Inheritable(IntPtr handle)
    {
        if (handle == IntPtr.Zero || handle == new IntPtr(-1)) return handle;
        IntPtr copy;
        return DuplicateHandle(GetCurrentProcess(), handle, GetCurrentProcess(), out copy, 0, true, DuplicateSameAccess) ? copy : handle;
    }

    // Same quoting as JobHost.cs (CommandLineToArgvW rules).
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

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct STARTUPINFO
    {
        public uint cb; public string lpReserved; public string lpDesktop; public string lpTitle;
        public uint dwX; public uint dwY; public uint dwXSize; public uint dwYSize;
        public uint dwXCountChars; public uint dwYCountChars; public uint dwFillAttribute;
        public uint dwFlags; public ushort wShowWindow; public ushort cbReserved2;
        public IntPtr lpReserved2; public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }
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

    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetConsoleCtrlHandler(IntPtr handler, [MarshalAs(UnmanagedType.Bool)] bool add);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GenerateConsoleCtrlEvent(uint ctrlEvent, uint processGroupId);
    [DllImport("kernel32.dll")] private static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool PostMessageW(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)] private static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetInformationJobObject(IntPtr job, int informationClass, IntPtr data, uint length);
    [StructLayout(LayoutKind.Sequential)] private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime; public long TotalKernelTime; public long ThisPeriodTotalUserTime; public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount; public uint TotalProcesses; public uint ActiveProcesses; public uint TotalTerminatedProcesses;
    }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool QueryInformationJobObject(IntPtr job, int informationClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION data, uint length, out uint returnLength);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, ExactSpelling = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcessW(string application, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, [MarshalAs(UnmanagedType.Bool)] bool inheritHandles, uint flags, IntPtr environment, string directory, ref STARTUPINFO startup, out PROCESS_INFORMATION process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetStdHandle(int kind);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, [MarshalAs(UnmanagedType.Bool)] bool inherit, uint options);
}
