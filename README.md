# INBEX AI Platform 

INBEX is a next-generation, AI-powered email automation and inbox management platform. It integrates directly with Gmail to fetch your emails, automatically classifies them, generates smart AI replies, and provides deep insights into your inbox patterns—all wrapped in a beautiful, responsive, glassmorphism UI.

## Features

- **Gmail Integration:** Securely connect via Google OAuth to fetch, read, and manage your live emails.
- **AI Classification & Prioritization:** Automatically categorizes emails (Work, Finance, Personal, HR, Spam) and assigns an AI-generated priority score (0-100) using **NVIDIA Nemotron 3 Super**.
- **Smart Replies:** Generate context-aware replies with adjustable tones (Formal, Friendly, Brief) in one click.
- **Deep Insights & Analytics:** Visualize your inbox habits over time with interactive Chart.js dashboards (Volume, Busiest Days, Category Breakdown).
- **Secure Authentication:** JWT-based user accounts with passwordless OTP verification powered by Resend.
- **Zero-Flash Theme Engine:** Seamless Light/Dark mode that respects OS preferences and syncs to your account.

## Technology Stack

**Frontend:**
- HTML5, Vanilla JavaScript, CSS3
- Custom CSS Variables for Theming & Layouts (No Heavy Frameworks)
- Chart.js for Data Visualization
- Markdown-it & DOMPurify for secure email rendering

**Backend:**
- Node.js & Express.js
- SQLite3 for lightweight, zero-config data persistence
- OpenRouter API for routing to multiple state-of-the-art LLMs (Google Gemma, OpenAI, Qwen, NVIDIA)
- Google APIs Node.js Client (Gmail OAuth)

## Getting Started

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v16 or higher)
- A Google Cloud Console project (for Gmail OAuth)
- An [OpenRouter](https://openrouter.ai/) API key
- A [Resend](https://resend.com/) API key (optional, for OTP emails)

### 2. Installation

Clone the repository and install dependencies:
```bash
git clone https://github.com/Suketu-ADT/inbex-ai.git
cd "inbex-ai/backend-node"
npm install
```

### 3. Configuration

Duplicate the example environment file:
```bash
cp .env.example .env
```

Fill out your `.env` file with the required credentials:
- `SECRET_KEY`: Your JWT secret
- `OPENROUTER_API_KEY`: Required for all AI features
- `GOOGLE_CLIENT_ID` & `GOOGLE_CLIENT_SECRET`: For Gmail login
- `RESEND_API_KEY`: For OTP functionality

### 4. Running the Server

Start the Node.js backend:
```bash
node server.js
```

The server will initialize the SQLite database and start on `http://localhost:3000`. You can now navigate to this URL in your browser!

## Authentication & OAuth Setup

To enable "Continue with Google", you must configure your Google Cloud project:
1. Enable the **Gmail API**.
2. Create an **OAuth Consent Screen**.
3. Create **OAuth Client ID** credentials (Web Application).
4. Add `http://localhost:3000` to Authorized JavaScript origins.
5. Add `http://localhost:3000/auth/google/callback` to Authorized redirect URIs.

## AI Model Configuration

INBEX uses OpenRouter to multiplex requests to various AI models based on the task. By default, it uses free-tier endpoints. You can change these in your `.env` file:
```env
MODEL_SUMMARIZE=google/gemma-4-31b-it:free
MODEL_SMART_REPLY=nvidia/nemotron-3-super-120b-a12b:free
MODEL_COMPOSE=openai/gpt-oss-120b:free
MODEL_CLASSIFY=google/gemma-4-31b-it:free
MODEL_PRIORITY_SCORE=nvidia/nemotron-3-super-120b-a12b:free
MODEL_INSIGHTS=google/gemma-4-31b-it:free
```

## License
This project is for educational and portfolio purposes. Feel free to fork and modify!
