using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Diagnostics;
using System.Drawing;
using System.Threading;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal sealed class Rosetta : Form {
    static readonly string Root = AppDomain.CurrentDomain.BaseDirectory;
    static readonly string Data = Path.Combine(Root, "data");
    static readonly string Ready = Path.Combine(Data, "server-ready.json");
    static Process Server;
    static string Address;
    static readonly object ProcessLock = new object();
    static bool Stopping;
    NotifyIcon Tray;
    Label Status;
    Button Open;

    static string Quote(string text) { return "\"" + text + "\""; }
    static string Get(string url) {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Proxy = null; request.Timeout = 1500;
        using (var response = request.GetResponse())
        using (var reader = new StreamReader(response.GetResponseStream())) return reader.ReadToEnd();
    }
    static void StartService() {
        Directory.CreateDirectory(Data);
        var node = Path.Combine(Root, ".runtime", "node", "node.exe");
        var python = Path.Combine(Root, ".runtime", "portable-python", "python.exe");
        if (!File.Exists(node) || !File.Exists(python) || !File.Exists(Path.Combine(Root,"dist","index.html")))
            throw new Exception("文件不完整，请完整解压下载的压缩包后再启动。");
        var config = Path.Combine(Data,"settings.env");
        if (!File.Exists(config)) File.Copy(Path.Combine(Root,".env.example"),config);
        if (File.Exists(Ready)) File.Delete(Ready);
        int port = 5199;
        for (;port < 5299;port++) {
            try { var probe = new TcpListener(IPAddress.Loopback,port); probe.Start(); probe.Stop(); break; }
            catch (SocketException) { }
        }
        var info = new ProcessStartInfo(node,Quote(Path.Combine(Root,"server.mjs")) + " " + Quote(Path.Combine(Root,"dist")) + " " + port + " --env " + Quote(config) + " --ready-file " + Quote(Ready));
        info.WorkingDirectory = Root; info.UseShellExecute = false; info.CreateNoWindow = true;
        info.RedirectStandardOutput = true; info.RedirectStandardError = true;
        info.EnvironmentVariables["ROSETTA_DATA_DIR"] = Data;
        Directory.CreateDirectory(Path.Combine(Data,"tmp"));
        info.EnvironmentVariables["TMP"] = Path.Combine(Data,"tmp");
        info.EnvironmentVariables["TEMP"] = Path.Combine(Data,"tmp");
        lock (ProcessLock) {
            if (Stopping) throw new Exception("启动已取消。");
            Server = Process.Start(info);
            // Drain output without writing configuration or personal paths to a log file.
            Server.OutputDataReceived += delegate { }; Server.ErrorDataReceived += delegate { };
            Server.BeginOutputReadLine(); Server.BeginErrorReadLine();
        }
        for (int i=0;i<200;i++) {
            if (Stopping) throw new Exception("启动已取消。");
            if (File.Exists(Ready)) {
                try {
                    var ready = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Ready));
                    Address = (string)ready["url"];
                    var uri = new Uri(Address);
                    if (uri.Host != "127.0.0.1" || uri.Scheme != "http") throw new Exception("无效的本地地址。");
                    if (Get(Address + "__pdf_reader_ping").Trim() == "pdf-translate-reader") return;
                } catch (IOException) { }
            }
            if (Server.HasExited) throw new Exception("本地服务未能启动，请确认文件夹可写且文件已完整解压。");
            Thread.Sleep(100);
        }
        throw new Exception("启动超时，请退出后重试。");
    }
    static void StopService() {
        lock (ProcessLock) {
            Stopping = true;
            if (Server != null && !Server.HasExited) {
                var info = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory,"taskkill.exe"),"/PID " + Server.Id + " /T /F");
                info.UseShellExecute=false; info.CreateNoWindow=true;
                try { using(var killer=Process.Start(info)) killer.WaitForExit(5000); } catch { try { Server.Kill(); } catch { } }
            }
        }
        try { if(File.Exists(Ready)) File.Delete(Ready); } catch { }
    }
    void Browse() { if(Address!=null) Process.Start(new ProcessStartInfo(Address) { UseShellExecute=true }); }
    Rosetta() {
        Text="Rosetta · 译读"; ClientSize=new Size(440,220); FormBorderStyle=FormBorderStyle.FixedDialog;
        MaximizeBox=false; StartPosition=FormStartPosition.CenterScreen;
        BackColor=Color.FromArgb(24,30,28); ForeColor=Color.FromArgb(220,232,205);
        Icon=new Icon(Path.Combine(Root,"assets","desktop","reader.ico"));
        var title=new Label { Text="Rosetta · 译读", AutoSize=true, Location=new Point(24,22), Font=new Font("Microsoft YaHei UI",17) };
        Status=new Label { Text="正在启动…",AutoSize=false,Size=new Size(390,55),Location=new Point(24,66),Font=new Font("Microsoft YaHei UI",10) };
        Open=new Button { Text="打开阅读器",Enabled=false,Location=new Point(24,135),Size=new Size(170,42),BackColor=Color.FromArgb(220,232,205),ForeColor=Color.FromArgb(24,30,28),FlatStyle=FlatStyle.Flat };
        Open.Click+=delegate { Browse(); };
        var exit=new Button {Text="退出",Location=new Point(210,135),Size=new Size(100,42)};
        exit.Click+=delegate { Close(); };
        Controls.AddRange(new Control[]{title,Status,Open,exit});
        Tray=new NotifyIcon {Icon=Icon,Text="Rosetta · 译读",Visible=true};
        var menu=new ContextMenuStrip(); menu.Items.Add("打开阅读器",null,delegate { Browse(); }); menu.Items.Add("退出 Rosetta",null,delegate { Close(); });
        Tray.ContextMenuStrip=menu; Tray.DoubleClick+=delegate { Show(); WindowState=FormWindowState.Normal; Activate(); Browse(); };
        Resize+=delegate { if(WindowState==FormWindowState.Minimized) Hide(); };
        FormClosing+=delegate { StopService(); Tray.Visible=false; Tray.Dispose(); };
        Shown+=async delegate {
            try { await Task.Run((Action)StartService); if(!Stopping) { Status.Text="已启动。关闭浏览器后，可从这里再次打开。\n退出此窗口将停止本地服务。"; Open.Enabled=true; Browse(); } }
            catch(Exception error) { if(!Stopping) Status.Text=error.Message; }
        };
    }
    [STAThread] static int Main(string[] args) {
        try {
            var hash=BitConverter.ToString(SHA256.Create().ComputeHash(Encoding.UTF8.GetBytes(Root.ToLowerInvariant()))).Replace("-","").Substring(0,24);
            bool first;
            using(var mutex=new Mutex(true,"Local\\Rosetta-"+hash,out first)) {
                if(!first) {
                    if(File.Exists(Ready)) { var r=new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string,object>>(File.ReadAllText(Ready)); Address=(string)r["url"]; if(new Uri(Address).Host=="127.0.0.1") Process.Start(new ProcessStartInfo(Address){UseShellExecute=true}); }
                    return 0;
                }
                if(args.Length>0 && args[0]=="--smoke-test") {
                    try { StartService(); var engine=Get(Address+"__full-translation/engine"); if(!engine.Contains("\"available\":true")) throw new Exception("Portable engine unavailable"); File.WriteAllText(Path.Combine(Data,"launcher-smoke.json"),"{\"passed\":true,\"url\":\""+Address+"\"}"); return 0; }
                    finally {StopService();}
                }
                Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false); Application.Run(new Rosetta());
            }
            return 0;
        } catch(Exception error) { if(args.Length==0) MessageBox.Show(error.Message,"Rosetta",MessageBoxButtons.OK,MessageBoxIcon.Error); return 1; }
    }
}
