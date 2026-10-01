#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Manager, RunEvent, State};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

const PROXY_PORT: u16 = 12334;

#[derive(Default)]
struct Core {
    child: Mutex<Option<Child>>,
    proxy_on: Mutex<bool>,
}

fn hide(cmd: &mut Command) {
    #[cfg(windows)]
    {
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let _ = cmd;
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let d = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&d).map_err(err)?;
    Ok(d)
}

/// sing-box.exe رو کنار برنامه، پوشه bin یا resources پیدا می‌کنه
fn singbox_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut c: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            c.push(dir.join("sing-box.exe"));
            c.push(dir.join("bin").join("sing-box.exe"));
        }
    }
    if let Ok(r) = app.path().resource_dir() {
        c.push(r.join("sing-box.exe"));
    }
    c.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bin").join("sing-box.exe"));
    c.into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| "sing-box.exe not found (put it next to MahyarVPN.exe)".to_string())
}

fn tail(path: &PathBuf) -> String {
    let s = fs::read_to_string(path).unwrap_or_default();
    let lines: Vec<&str> = s.lines().collect();
    let t = lines[lines.len().saturating_sub(12)..].join("\n");
    if t.trim().is_empty() { "sing-box exited unexpectedly".into() } else { t }
}

fn check_config(sb: &PathBuf, cfg: &PathBuf) -> Result<(), String> {
    let mut cmd = Command::new(sb);
    cmd.arg("check").arg("-c").arg(cfg).arg("--disable-color");
    hide(&mut cmd);
    let out = cmd.output().map_err(err)?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "{}{}",
            String::from_utf8_lossy(&out.stderr),
            String::from_utf8_lossy(&out.stdout)
        ))
    }
}

fn spawn_core(dir: &PathBuf, sb: &PathBuf, cfg: &PathBuf, log: &PathBuf) -> Result<Child, String> {
    let f = fs::File::create(log).map_err(err)?;
    let f2 = f.try_clone().map_err(err)?;
    let mut cmd = Command::new(sb);
    cmd.arg("run")
        .arg("-c")
        .arg(cfg)
        .arg("-D")
        .arg(dir)
        .arg("--disable-color")
        .stdin(Stdio::null())
        .stdout(Stdio::from(f))
        .stderr(Stdio::from(f2));
    hide(&mut cmd);
    cmd.spawn().map_err(err)
}

fn kill_core(core: &Core) {
    if let Some(mut c) = core.child.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

// ---------------- System proxy (Windows registry) ----------------
#[cfg(windows)]
mod sysproxy {
    use std::ffi::c_void;
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};

    #[link(name = "wininet")]
    extern "system" {
        fn InternetSetOptionW(h: *mut c_void, opt: u32, buf: *mut c_void, len: u32) -> i32;
    }

    const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

    fn refresh() {
        unsafe {
            InternetSetOptionW(std::ptr::null_mut(), 39, std::ptr::null_mut(), 0); // SETTINGS_CHANGED
            InternetSetOptionW(std::ptr::null_mut(), 37, std::ptr::null_mut(), 0); // REFRESH
        }
    }

    pub fn set(enable: bool, port: u16) -> Result<(), String> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(KEY)
            .map_err(|e| e.to_string())?;
        if enable {
            key.set_value("ProxyServer", &format!("127.0.0.1:{port}")).map_err(|e| e.to_string())?;
            key.set_value(
                "ProxyOverride",
                &"localhost;127.*;10.*;172.16.*;172.17.*;172.18.*;172.19.*;172.2*;172.30.*;172.31.*;192.168.*;<local>".to_string(),
            )
            .map_err(|e| e.to_string())?;
            key.set_value("ProxyEnable", &1u32).map_err(|e| e.to_string())?;
        } else {
            key.set_value("ProxyEnable", &0u32).map_err(|e| e.to_string())?;
        }
        refresh();
        Ok(())
    }

    /// اگه دفعه قبل برنامه کرش کرده و پروکسی روشن مونده، خاموشش کن
    pub fn cleanup_stale(port: u16) {
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER).open_subkey(KEY) {
            let on: u32 = key.get_value("ProxyEnable").unwrap_or(0);
            let srv: String = key.get_value("ProxyServer").unwrap_or_default();
            if on == 1 && srv == format!("127.0.0.1:{port}") {
                let _ = set(false, port);
            }
        }
    }
}

#[cfg(not(windows))]
mod sysproxy {
    pub fn set(_e: bool, _p: u16) -> Result<(), String> { Ok(()) }
    pub fn cleanup_stale(_p: u16) {}
}

fn set_proxy(core: &Core, enable: bool, port: u16) -> Result<(), String> {
    let mut on = core.proxy_on.lock().unwrap();
    if !enable && !*on {
        return Ok(());
    }
    sysproxy::set(enable, port)?;
    *on = enable;
    Ok(())
}

fn urlencode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{:02X}", b),
        })
        .collect()
}

// ---------------- Commands ----------------
#[tauri::command]
async fn start_core(app: AppHandle, config: String, system_proxy: bool, port: u16) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let core = app.state::<Core>();
        kill_core(&core);
        let _ = set_proxy(&core, false, port);
        let dir = data_dir(&app)?;
        let cfg = dir.join("config.json");
        let log = dir.join("core.log");
        fs::write(&cfg, config).map_err(err)?;
        let sb = singbox_path(&app)?;
        check_config(&sb, &cfg)?;
        let mut child = spawn_core(&dir, &sb, &cfg, &log)?;
        thread::sleep(Duration::from_millis(1500));
        if let Ok(Some(_)) = child.try_wait() {
            return Err(tail(&log));
        }
        *core.child.lock().unwrap() = Some(child);
        if system_proxy {
            if let Err(e) = set_proxy(&core, true, port) {
                kill_core(&core);
                return Err(e);
            }
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
async fn stop_core(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let core = app.state::<Core>();
        kill_core(&core);
        set_proxy(&core, false, PROXY_PORT)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn core_running(core: State<'_, Core>) -> bool {
    let mut g = core.child.lock().unwrap();
    match g.as_mut() {
        Some(c) => matches!(c.try_wait(), Ok(None)),
        None => false,
    }
}

/// تست پینگ واقعی: یه sing-box موقت با همه سرورها بالا میاد و از طریق
/// Clash API برای هر سرور یه درخواست HTTP واقعی زده میشه
#[tauri::command]
async fn test_delays(app: AppHandle, config: String, count: usize, url: String, timeout: u32) -> Result<Vec<i64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .map_err(err)?
            .port();
        let mut v: serde_json::Value = serde_json::from_str(&config).map_err(err)?;
        v["experimental"] = serde_json::json!({
            "clash_api": { "external_controller": format!("127.0.0.1:{port}") }
        });
        let dir = data_dir(&app)?;
        let cfg = dir.join("test.json");
        let log = dir.join("test.log");
        fs::write(&cfg, v.to_string()).map_err(err)?;
        let sb = singbox_path(&app)?;
        check_config(&sb, &cfg)?;
        let mut child = spawn_core(&dir, &sb, &cfg, &log)?;

        let agent = ureq::AgentBuilder::new()
            .timeout(Duration::from_millis(timeout as u64 + 3000))
            .build();
        let base = format!("http://127.0.0.1:{port}");
        let start = Instant::now();
        let mut ready = false;
        while start.elapsed() < Duration::from_secs(8) {
            if let Ok(Some(_)) = child.try_wait() {
                break;
            }
            if agent.get(&format!("{base}/version")).call().is_ok() {
                ready = true;
                break;
            }
            thread::sleep(Duration::from_millis(150));
        }
        if !ready {
            let _ = child.kill();
            let _ = child.wait();
            return Err(tail(&log));
        }

        let enc = urlencode(&url);
        let mut results = vec![-1i64; count];
        let mut i0 = 0;
        while i0 < count {
            let end = (i0 + 16).min(count);
            thread::scope(|s| {
                let handles: Vec<_> = (i0..end)
                    .map(|i| {
                        let agent = &agent;
                        let base = &base;
                        let enc = &enc;
                        s.spawn(move || -> i64 {
                            let u = format!("{base}/proxies/n{i}/delay?timeout={timeout}&url={enc}");
                            match agent.get(&u).call() {
                                Ok(resp) => resp
                                    .into_string()
                                    .ok()
                                    .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
                                    .and_then(|j| j["delay"].as_i64())
                                    .filter(|d| *d > 0)
                                    .unwrap_or(-1),
                                Err(_) => -1,
                            }
                        })
                    })
                    .collect();
                for (k, h) in handles.into_iter().enumerate() {
                    results[i0 + k] = h.join().unwrap_or(-1);
                }
            });
            i0 = end;
        }
        let _ = child.kill();
        let _ = child.wait();
        Ok(results)
    })
    .await
    .map_err(err)?
}

/// دریافت ساب‌اسکریپشن؛ آدرس‌ها به ترتیب امتحان میشن (اصلی، بعد میرور)
#[tauri::command]
async fn fetch_text(urls: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(15)).build();
        let mut errs = Vec::new();
        for u in urls {
            match agent.get(&u).set("User-Agent", "MahyarVPN/1.0").call() {
                Ok(r) => match r.into_string() {
                    Ok(s) if !s.trim().is_empty() => return Ok(s),
                    Ok(_) => errs.push(format!("{u}: empty")),
                    Err(e) => errs.push(format!("{u}: {e}")),
                },
                Err(e) => errs.push(format!("{u}: {e}")),
            }
        }
        Err(errs.join("\n"))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
fn is_admin() -> bool {
    #[cfg(windows)]
    {
        let mut c = Command::new("net");
        c.arg("session").stdout(Stdio::null()).stderr(Stdio::null());
        hide(&mut c);
        c.status().map(|s| s.success()).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        true
    }
}

#[tauri::command]
fn relaunch_admin(app: AppHandle) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(err)?;
    let core = app.state::<Core>();
    kill_core(&core);
    let _ = set_proxy(&core, false, PROXY_PORT);
    let script = format!(
        "Start-Process -FilePath '{}' -Verb RunAs",
        exe.display().to_string().replace('\'', "''")
    );
    let mut c = Command::new("powershell");
    c.args(["-NoProfile", "-WindowStyle", "Hidden", "-Command"]).arg(script);
    hide(&mut c);
    let st = c.status().map_err(err)?;
    if st.success() {
        app.exit(0);
        Ok(())
    } else {
        Err("UAC was cancelled".into())
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Core::default())
        .setup(|_app| {
            sysproxy::cleanup_stale(PROXY_PORT);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            start_core,
            stop_core,
            core_running,
            test_delays,
            fetch_text,
            is_admin,
            relaunch_admin
        ])
        .build(tauri::generate_context!())
        .expect("failed to start MahyarVPN")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                let core = app.state::<Core>();
                kill_core(&core);
                let _ = set_proxy(&core, false, PROXY_PORT);
            }
        });
}
