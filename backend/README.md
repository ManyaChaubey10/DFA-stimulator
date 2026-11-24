# DFA Studio API

Run from the repository root in PowerShell. The existing backend virtual environment is `backend\venv`:

```powershell
backend\venv\Scripts\Activate.ps1
uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1
```

If needed, create the environment and install dependencies first:

```powershell
python -m venv backend\venv
backend\venv\Scripts\Activate.ps1
pip install -r backend\requirements.txt
```

The API is available at http://127.0.0.1:8000. Health check: `/health`; interactive docs: `/docs`.

`POST /api/dfa` returns the complete subset-construction DFA plus a `minimized_dfa` computed by reachable-state partition refinement.
