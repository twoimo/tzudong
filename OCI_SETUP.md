# OCI Server Setup Guide (Gemini OCR Daemon)

## 0. Prerequisite
- **Public IP**: `129.154.55.232` (Provided)
- **Port**: 3456 (Must be opened in Security List)

## 1. Remote Server Setup
SSH into your OCI server:
```bash
ssh ubuntu@129.154.55.232
```

### Install Node.js (if not installed)
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Setup Project Directory
```bash
mkdir -p ~/gemini-ocr
cd ~/gemini-ocr
```

### Install Dependencies
```bash
# Initialize minimal project
npm init -y

# Install Google Gemini CLI (Global or Local)
# We recommend local to avoid permission issues
npm install @google/gemini-cli
```

### Authentication (Crucial)
You need to authenticate on the server once.
```bash
npx gemini auth login
# Follow instructions to paste the code in your browser
```
*Verification*: Run `npx gemini "Hello"` to confirm it works.

## 2. Deploy Daemon Script
Copy the content of `apps/web/scripts/gemini-daemon.mjs` to the OCI server as `daemon.mjs`.

You can use `scp` from your local machine:
```bash
scp -r apps/web/scripts/gemini-daemon.mjs ubuntu@129.154.55.232:~/gemini-ocr/daemon.mjs
```

## 3. Run the Daemon
Use PM2 to keep it running in the background.
```bash
sudo npm install -g pm2
pm2 start daemon.mjs --name "gemini-ocr"
pm2 save
pm2 startup
```

## 4. Firewall Settings (Ingress)
1. Go to **Oracle Cloud Console** > **Networking** > **VCN** > **Security Lists**.
2. Edit the **Default Security List**.
3. Add **Ingress Rule**:
    - **Source**: `0.0.0.0/0` (or `76.76.21.0/24` for Vercel IPs if known, but 0.0.0.0 is easiest)
    - **Protocol**: TCP
    - **Destination Port**: 3456
4. **Important**: You might also need to open the port on the instance's internal firewall (`iptables`).
```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 3456 -j ACCEPT
sudo netfilter-persistent save
```

## 5. Connect Vercel
Add the Environment Variable in Vercel:
- **Key**: `OCI_GEMINI_API_URL`
- **Value**: `http://129.154.55.232:3456`
