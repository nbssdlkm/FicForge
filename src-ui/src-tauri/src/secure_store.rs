// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

use keyring::{Entry, Error as KeyringError};

const SECRET_STORE_SERVICE: &str = "com.ficforge.app";

fn entry_for(key: &str) -> Result<Entry, String> {
    if key.trim().is_empty() {
        return Err("secure store key must not be empty".into());
    }

    Entry::new(SECRET_STORE_SERVICE, key)
        .map_err(|err| format!("failed to create secure store entry for {key}: {err}"))
}

#[tauri::command]
pub fn secure_store_get(key: String) -> Result<Option<String>, String> {
    let entry = entry_for(&key)?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(format!(
            "failed to read secure store entry for {key}: {err}"
        )),
    }
}

#[tauri::command]
pub fn secure_store_set(key: String, value: String) -> Result<(), String> {
    let entry = entry_for(&key)?;
    entry
        .set_password(&value)
        .map_err(|err| format!("failed to write secure store entry for {key}: {err}"))
}

#[tauri::command]
pub fn secure_store_remove(key: String) -> Result<(), String> {
    let entry = entry_for(&key)?;
    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(format!(
            "failed to delete secure store entry for {key}: {err}"
        )),
    }
}
