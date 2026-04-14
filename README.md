# 🏎️ boostLog - High Performance Datalog Visualizer

**boostLog** is a premium, AI-augmented telemetry platform designed for automotive enthusiasts and tuners. It transforms raw CSV datalogs into interactive, high-fidelity visualizations and provides automated "Master Tuner" insights using local LLM processing.

![Dashboard Preview](static/brand_lockup_transparent.png)

## 🌟 Key Features
- **Instant Visualization:** Drag-and-drop CSV uploads with interactive Chart.js graphs.
- **AI Tuning Agent:** Automated log analysis via local **Ollama** integration (Llama 3).
- **Secure Silos:** Private user accounts with **GitHub SSO** and JWT authentication.
- **Enterprise Ready:** Infrastructure managed via **Terraform** and deployed to AWS with **Cloudflare Tunnels**.
- **High Performance:** Backend powered by **FastAPI** and **Polars** for memory-speed data processing.

---

## 🚀 Getting Started

### 1. Local Development (Native)
Run the server directly on your macOS host for rapid frontend/backend iteration.

```bash
# Setup Virtual Environment
python3 -m venv venv
source venv/bin/activate

# Install Dependencies
pip install -r requirements.txt

# Start Development Server
uvicorn main:app --port 8000 --reload
```
*Note: Ensure you have an `.env` file with `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET`.*

### 2. Docker Execution (Recommended)
Spin up the entire stack (FastAPI, Postgres, Ollama, Cloudflare Tunnel) with one command.

```bash
# Build and start all services
docker-compose up -d --build
```
This launches:
- **Web App:** [http://localhost:8000](http://localhost:8000)
- **Database:** PostgreSQL (Internal)
- **AI Agent:** Ollama (Pulling llama3 automatically)

---

## 🧪 Testing
We use `pytest` and `playwright` for end-to-end and logic verification.

```bash
# Run all tests
pytest

# Run tests with coverage report
pytest --cov=main
```

---

## 🏗️ Infrastructure & Deployment
The platform is designed for a modern CI/CD flow:
1. **Infrastructure:** Managed in `/terraform` (S3 backend for state).
2. **CI/CD:** GitHub Actions (`.github/workflows`) handles:
   - Automated testing on Pull Requests.
   - Building and pushing images to **GHCR**.
   - Triggering production deployment to EC2 via **AWS SSM**.
3. **Connectivity:** Secured via **Cloudflare Tunnels** (Zero-ingress architecture).

---

## 🛠️ Tech Stack
- **Backend:** FastAPI, Polars, LiteLLM, SQLAlchemy
- **Frontend:** Vanilla JS, Tailwind-lite CSS, Chart.js, Marked.js
- **Database:** PostgreSQL (Migration in progress)
- **DevOps:** Docker, Terraform, GitHub Actions, AWS SSM

---

## 🛡️ License
MIT License. Created by jtarang.
