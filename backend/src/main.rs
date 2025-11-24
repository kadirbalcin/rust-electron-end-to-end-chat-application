use std::collections::HashMap;
use std::collections::HashSet;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread;
use lazy_static::lazy_static;

type Clients = Arc<Mutex<HashMap<String, TcpStream>>>;

lazy_static! {
    static ref BUSY: Mutex<HashSet<String>> = Mutex::new(HashSet::new());
}

fn handle_client(mut stream: TcpStream, clients: Clients) {
    let mut buffer = [0u8; 4096];

    // İlk mesaj = CLIENT_ID
    let size = stream.read(&mut buffer).unwrap();
    let client_id = String::from_utf8_lossy(&buffer[..size]).trim().to_string();

    // println!("Client connected with ID: {}", client_id);

    // Clientları sakla
    clients.lock().unwrap().insert(client_id.clone(), stream.try_clone().unwrap());

    loop {
        let size = match stream.read(&mut buffer) {
            Ok(s) => s,
            Err(_) => break,
        };
        if size == 0 {
            break;
        }

        // Gelen mesajı al ve işle
        let msg = String::from_utf8_lossy(&buffer[..size]).to_string();

        // Bağlantı isteği gönderildiyse.
        if msg.starts_with("CONNECT:") {
            let target = msg.replace("CONNECT:", "").trim().to_string();
            if let Some(s) = clients.lock().unwrap().get_mut(&target) {
                if BUSY.lock().unwrap().contains(&target) {
                    // bu client meşgul
                    let _ = stream.write_all(format!("BUSY:{}\n", target).as_bytes());
                    println!("Client {} is busy, cannot connect {}", target, client_id);
                } else {
                    // Hedef client'a bağlantı isteği gönder
                    let _ = s.write_all(format!("INCOMING:{}\n", client_id).as_bytes());
                }
            }
        }

        // Incoming olarak giden bağlantı kabul edildi.
        else if msg.starts_with("ACCEPT:") {
            let target = msg.replace("ACCEPT:", "").trim().to_string();

            // Burada **ortak sessionKey** oluşturma mantığını client’a ileteceğiz
            // Bu key Electron tarafında generate edilip base64 olarak gönderilecek
            // Server sadece "SESSIONKEY:<target>:<key>" olarak forward ediyor
            if let Some(s) = clients.lock().unwrap().get_mut(&target) {
                // Server tarafında key üretimi yok, sadece client tarafından gönderilen key'i diğer tarafa iletir
                let parts: Vec<&str> = msg.splitn(2, ":").collect();
                // meşgul durumuna ekle
                {
                    let mut busy = BUSY.lock().unwrap();
                    busy.insert(target.clone());
                    busy.insert(client_id.clone());
                }
                // msg: ACCEPT:<target>:<b64key> ise burayı parse edip gönder
                // Biz basit yaptık, Electron tarafında ACCEPT butonunda SESSIONKEY gönderilecek
                let _ = s.write_all(format!("ACCEPTED:{}\n", client_id).as_bytes());
            }
        }

        // disconnect olduğunda
        else if msg.starts_with("DISCONNECT:") {
            let target = msg.replace("DISCONNECT:", "").trim().to_string();
            if let Some(s) = clients.lock().unwrap().get_mut(&target) {

                // meşgul durumunu kaldır
                {
                    let mut busy = BUSY.lock().unwrap();
                    busy.remove(&target);
                    busy.remove(&client_id);
                }
                let _ = s.write_all(format!("DISCONNECTED:{}\n", client_id).as_bytes());
            }
        }

        // client mesaj gönderdiğinde şifrelemeye dokunmadan server üzerinden ilet
        else if msg.starts_with("MSG:") {
            let parts: Vec<&str> = msg.splitn(3, ":").collect();
            let target = parts[1];
            let encrypted_json = parts[2];

            if let Some(s) = clients.lock().unwrap().get_mut(target) {
                let _ = s.write_all(format!("MSG:{}:{}\n", client_id, encrypted_json).as_bytes());
            }
        }

        // session key gönderildiğinde
        else if msg.starts_with("SESSIONKEY:") {
            // SESSIONKEY:<target>:<b64key>
            let parts: Vec<&str> = msg.splitn(3, ":").collect();
            let target = parts[1];
            let b64key = parts[2];

            if let Some(s) = clients.lock().unwrap().get_mut(target) {
                let _ = s.write_all(format!("SESSIONKEY:{}:{}", client_id, b64key).as_bytes());
            }
        }
    }

    println!("Client disconnected: {}", client_id);
    clients.lock().unwrap().remove(&client_id);
}

fn main() {
    let server = TcpListener::bind("0.0.0.0:9000").unwrap();
    let clients: Clients = Arc::new(Mutex::new(HashMap::new()));

    println!("Server started at 9000");

    for conn in server.incoming() {
        match conn {
            Ok(stream) => {
                let clients_clone = clients.clone();
                thread::spawn(move || handle_client(stream, clients_clone));
            }
            Err(_) => continue,
        }
    }
}
