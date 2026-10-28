use keyring::{Entry, Error as KeyringError};

const SERVICE: &str = "omilo";
const ACCOUNT: &str = "auth_token";

/// Read the auth token from the OS keychain.
/// Returns None if the entry is absent or any error occurs — never panics.
#[tauri::command]
pub fn get_token() -> Option<String> {
    Entry::new(SERVICE, ACCOUNT)
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

/// Store the auth token in the OS keychain.
/// Returns Err(message) on failure. The token value is never logged.
#[tauri::command]
pub fn set_token(token: String) -> Result<(), String> {
    Entry::new(SERVICE, ACCOUNT)
        .map_err(|e| e.to_string())
        .and_then(|entry| entry.set_password(&token).map_err(|e| e.to_string()))
}

/// Delete the auth token from the OS keychain.
/// Treats NoEntry (not found) as success; maps other errors to Err(message).
#[tauri::command]
pub fn clear_token() -> Result<(), String> {
    let entry = Entry::new(SERVICE, ACCOUNT).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(KeyringError::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
