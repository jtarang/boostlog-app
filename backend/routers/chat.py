import asyncio
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.auth.core import get_current_user
from backend.db import get_db
from backend.models import Analysis, Datalog, User

router = APIRouter()

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]

@router.post("/api/analyze/{filename}/chat")
async def chat_about_log(filename: str, request: ChatRequest, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    filename = os.path.basename(filename)
    datalog = db.query(Datalog).filter(
        Datalog.stored_filename == filename,
        Datalog.user_id == current_user.id,
    ).first()
    if not datalog:
        raise HTTPException(status_code=403, detail="Not authorized to access this log")

    latest_analysis = db.query(Analysis).filter(
        Analysis.datalog_id == datalog.id
    ).order_by(Analysis.created_at.desc()).first()

    if not latest_analysis:
        raise HTTPException(status_code=400, detail="Please run the initial analysis first.")

    system_prompt = f"""You are **Moose** — a seasoned, no-nonsense professional automotive tuner.
You recently analyzed a datalog and provided the following report:

{latest_analysis.result_markdown}

Answer the user's follow-up questions concisely and professionally based on this context. 
If the user asks about something not in the report, use your general tuning knowledge, but remind them it's not in the current data summary.
Format your response using Markdown where appropriate.
"""

    messages = [{"role": "system", "content": system_prompt}]
    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})

    from litellm import completion

    ollama_model = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
    model_name = f"ollama/{ollama_model}"
    api_base = os.getenv("OLLAMA_API_BASE", "http://localhost:11434")

    mock_response = os.getenv("MOCK_AI_RESPONSE")
    if mock_response:
        result_text = "This is a mock response from Moose. Your tuning looks acceptable based on the previous summary."
    else:
        def _run_llm():
            return completion(
                model=model_name,
                api_base=api_base,
                messages=messages,
                temperature=0.3,
            )

        try:
            response = await asyncio.to_thread(_run_llm)
            result_text = response.choices[0].message.content
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LLM Error: {str(e)}")

    return {"response": result_text}
