using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;

namespace SmartDisplayLauncher
{
    static class Program
    {
        [StructLayout(LayoutKind.Sequential)]
        struct STARTUPINFO
        {
            public int cb;
            public string lpReserved;
            public string lpDesktop;
            public string lpTitle;
            public int dwX;
            public int dwY;
            public int dwXSize;
            public int dwYSize;
            public int dwXCountChars;
            public int dwYCountChars;
            public int dwFillAttribute;
            public int dwFlags;
            public short wShowWindow;
            public short cbReserved2;
            public IntPtr lpReserved2;
            public IntPtr hStdInput;
            public IntPtr hStdOutput;
            public IntPtr hStdError;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct PROCESS_INFORMATION
        {
            public IntPtr hProcess;
            public IntPtr hThread;
            public int dwProcessId;
            public int dwThreadId;
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        static extern bool CreateProcess(
            string lpApplicationName,
            string lpCommandLine,
            IntPtr lpProcessAttributes,
            IntPtr lpThreadAttributes,
            bool bInheritHandles,
            uint dwCreationFlags,
            IntPtr lpEnvironment,
            string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation);

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CloseHandle(IntPtr hObject);

        const uint DETACHED_PROCESS = 0x00000008;
        const uint CREATE_NO_WINDOW = 0x08000000;
        const uint CREATE_NEW_PROCESS_GROUP = 0x00000200;

        [STAThread]
        static void Main()
        {
            string currentDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            
            if (!IsPortOpen("127.0.0.1", 8686))
            {
                string targetExe = Path.Combine(currentDir, "SmartDisplay_ADB_Manager.exe");
                string workingDir = currentDir;

                if (!File.Exists(targetExe))
                {
                    string distExe = Path.Combine(currentDir, "dist", "SmartDisplay_ADB_Manager.exe");
                    if (File.Exists(distExe))
                    {
                        targetExe = distExe;
                        workingDir = Path.Combine(currentDir, "dist");
                    }
                }

                if (File.Exists(targetExe))
                {
                    STARTUPINFO si = new STARTUPINFO();
                    si.cb = Marshal.SizeOf(si);
                    si.dwFlags = 1; // STARTF_USESHOWWINDOW
                    si.wShowWindow = 0; // SW_HIDE

                    PROCESS_INFORMATION pi = new PROCESS_INFORMATION();
                    uint flags = CREATE_NO_WINDOW | DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;

                    if (CreateProcess(null, "\"" + targetExe + "\"", IntPtr.Zero, IntPtr.Zero, false, flags, IntPtr.Zero, workingDir, ref si, out pi))
                    {
                        if (pi.hProcess != IntPtr.Zero) CloseHandle(pi.hProcess);
                        if (pi.hThread != IntPtr.Zero) CloseHandle(pi.hThread);
                    }
                }

                // Wait up to 3 seconds for port 8686 to open
                for (int i = 0; i < 15; i++)
                {
                    Thread.Sleep(200);
                    if (IsPortOpen("127.0.0.1", 8686)) break;
                }
            }

            // Open browser
            try
            {
                Process.Start(new ProcessStartInfo("http://localhost:8686") { UseShellExecute = true });
            }
            catch {}
        }

        static bool IsPortOpen(string host, int port)
        {
            try
            {
                using (TcpClient client = new TcpClient())
                {
                    var result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(300);
                    if (success && client.Connected)
                    {
                        client.EndConnect(result);
                        return true;
                    }
                    return false;
                }
            }
            catch
            {
                return false;
            }
        }
    }
}
