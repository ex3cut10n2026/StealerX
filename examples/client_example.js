const dns = require('dns');
const os = require('os');
const crypto = require('crypto');
const readline = require('readline');

// Configuration
const API_URL = "http://localhost:5000/api/client";
const APP_NAME = "My Node Script";
// Replace with the actual secret from your Dashboard
const APP_SECRET = "YOUR_APP_SECRET_HERE"; 

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function getHWID() {
  // Simple HWID based on system info
  const info = [
    os.platform(),
    os.arch(),
    os.hostname(),
    os.totalmem()
  ].join('-');
  return crypto.createHash('sha256').update(info).digest('hex');
}

async function apiRequest(endpoint, payload) {
  const response = await fetch(`${API_URL}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return response.json();
}

function prompt(question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  console.log("=== KeyShield Node.js Client ===");

  // 1. Handshake
  console.log("[*] Initializing session with licensing server...");
  let sessionId;
  try {
    const data = await apiRequest('init', { app_name: APP_NAME, secret: APP_SECRET });
    if (!data.success) {
      console.log(`[-] Handshake Failed: ${data.message}`);
      process.exit(1);
    }
    sessionId = data.session_id;
    console.log(`[+] Initialized! Session ID: ${sessionId.slice(0, 8)}...`);
  } catch (error) {
    console.error("[-] Connection failed:", error.message);
    process.exit(1);
  }

  // 2. Authenticate Key
  const licenseKey = await prompt("Enter your License Key: ");
  const hwid = getHWID();

  console.log("[*] Verifying key...");
  try {
    const loginData = await apiRequest('login', {
      session_id: sessionId,
      key: licenseKey.trim(),
      hwid: hwid
    });

    if (!loginData.success) {
      console.log(`[-] Access Denied: ${loginData.message}`);
      process.exit(1);
    }

    console.log("[+] Access Granted!");
    console.log(`    Expiry Date: ${loginData.expiry}`);
  } catch (error) {
    console.error("[-] Verification error:", error.message);
    process.exit(1);
  }

  // 3. Fetch remote variable
  const varName = "welcome_msg";
  console.log(`[*] Fetching remote variable: ${varName}`);
  try {
    const varData = await apiRequest('var', { session_id: sessionId, name: varName });
    if (varData.success) {
      console.log(`[+] Variable value: ${varData.value}`);
    } else {
      console.log(`[-] Failed to fetch variable: ${varData.message}`);
    }
  } catch (error) {
    console.error("[-] Variable fetch error:", error.message);
  }

  // 4. Remote logging
  try {
    await apiRequest('log', { session_id: sessionId, message: "Node client active." });
  } catch (e) {}

  console.log("[+] KeyShield authorization complete! Running main script code...");
  rl.close();
}

main();
