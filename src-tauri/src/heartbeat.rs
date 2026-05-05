use std::fs;
use std::path::PathBuf;
use std::thread;
use std::time::Duration as StdDuration;

pub fn heartbeat_timestamp_ms(path: &PathBuf) -> Option<i64> {
    let metadata = fs::metadata(path).ok()?;
    let modified = metadata.modified().ok()?;
    let duration = modified.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(duration.as_millis()).ok()
}

pub fn start_heartbeat_writer(path: PathBuf) {
    thread::spawn(move || loop {
        let _ = fs::write(&path, "alive");
        thread::sleep(StdDuration::from_secs(30));
    });
}
