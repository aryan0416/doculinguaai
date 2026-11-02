# main.py
import io
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import json
from sqlalchemy.orm import Session
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
import yake
from gtts import gTTS

# Presidio imports
from presidio_analyzer import AnalyzerEngine
from presidio_anonymizer import AnonymizerEngine
from presidio_anonymizer.entities import OperatorConfig

# Absolute imports for local modules
import models
import database
from database import get_db, engine

# --- Third-party Imports ---
from jose import JWTError, jwt
import langdetect
import pdfplumber
import pytesseract
import requests
import spacy
from docx import Document as py_docx
from dotenv import load_dotenv
from fastapi import (Body, Depends, FastAPI, File, Form, Header,
                     HTTPException, Security, UploadFile, status)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from PIL import Image

# --- Local Translation Library ---
import argostranslate.package
import argostranslate.translate

# --- Optional Groq Client ---
try:
    from groq import Groq
except ImportError:
    Groq = None

# --- Environment Setup & Configuration ---
load_dotenv()

models.Base.metadata.create_all(bind=engine)

# Service configurations
TESSERACT_CMD = os.environ.get("TESSERACT_CMD")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY")
GROQ_QA_MODEL = os.environ.get("GROQ_QA_MODEL", "llama3-70b-8192")

# Authentication configurations
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")
JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 5*60 * 24  # 1 day
# Application configurations
REQUEST_TIMEOUT = int(os.environ.get("REQUEST_TIMEOUT", 30))
MAX_FILE_SIZE = int(os.environ.get("MAX_FILE_SIZE", 50 * 1024 * 1024))  # 50MB
SUPPORTED_LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "ja", "zh", "ru", "ko", "ar"]

if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# --- FastAPI App Initialization ---
app = FastAPI(
    title="DocuLinguaAI Secure Backend",
    description="Advanced API for document processing, translation, Q&A, and analytics with user authentication.",
    version="5.0.0", # Version bump for Groq summarization
)

frontend_urls_env = os.environ.get("FRONTEND_URLS", "http://localhost:3000,http://127.0.0.1:5500,http://localhost:5500")
FRONTEND_URLS = [u.strip() for u in frontend_urls_env.split(",") if u.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_URLS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Global Clients and Models ---
sentiment_analyzer = SentimentIntensityAnalyzer()
presidio_analyzer = AnalyzerEngine()
presidio_anonymizer = AnonymizerEngine()

groq_client = None
if Groq and GROQ_API_KEY:
    try:
        groq_client = Groq(api_key=GROQ_API_KEY)
        logging.info("Groq client initialized successfully.")
    except Exception as e:
        logging.error(f"Failed to initialize Groq client: {e}")
else:
    logging.warning("Groq client not configured or missing GROQ_API_KEY — Q&A, Quiz, and Summarization features disabled.")

nlp: Optional[Any] = None
try:
    nlp = spacy.load("en_core_web_lg")
    logging.info("spaCy model 'en_core_web_lg' loaded successfully.")
except OSError:
    logging.error("spaCy 'en_core_web_lg' not found. Please run: python -m spacy download en_core_web_lg")


# --- Helper Functions ---
def validate_file_extension(file: UploadFile) -> None:
    allowed_extensions = [".pdf", ".docx", ".txt", ".png", ".jpg", ".jpeg", ".bmp", ".tiff"]
    if not any(file.filename.lower().endswith(ext) for ext in allowed_extensions):
        raise HTTPException(status_code=400, detail=f"Unsupported file type. Allowed: {', '.join(allowed_extensions)}")

def analyze_sentiment(text: str) -> dict:
    return sentiment_analyzer.polarity_scores(text)

def extract_keywords(text: str) -> List[Dict[str, Any]]:
    kw_extractor = yake.KeywordExtractor(lan="en", n=1, dedupLim=0.9, top=20, features=None)
    keywords = kw_extractor.extract_keywords(text)
    return [{"term": kw[0], "score": kw[1]} for kw in keywords]

def analyze_and_redact_pii(text: str, redact: bool = False) -> Dict[str, Any]:
    pii_results = presidio_analyzer.analyze(text=text, language='en')
    
    redacted_text = text
    if redact:
        operators = {
            "DEFAULT": OperatorConfig("replace", {"new_value": "[REDACTED]"}),
            "PHONE_NUMBER": OperatorConfig("mask", {"type": "mask", "masking_char": "*", "chars_to_mask": 12, "from_end": False}),
            "CREDIT_CARD": OperatorConfig("mask", {"type": "mask", "masking_char": "*", "chars_to_mask": 16, "from_end": False}),
        }
        anonymized_result = presidio_anonymizer.anonymize(
            text=text, analyzer_results=pii_results, operators=operators
        )
        redacted_text = anonymized_result.text

    formatted_pii = [
        {"text": text[res.start:res.end], "type": res.entity_type, "score": round(res.score, 2), "start": res.start, "end": res.end}
        for res in pii_results
    ]
    return {"original_pii": formatted_pii, "redacted_text": redacted_text}

def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            return "\n\n".join(p.extract_text() or "" for p in pdf.pages)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF extraction failed: {str(e)}")

def extract_text_from_docx(file_bytes: bytes) -> str:
    try:
        doc = py_docx(io.BytesIO(file_bytes))
        return "\n\n".join(para.text for para in doc.paragraphs if para.text and para.text.strip())
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"DOCX extraction failed: {str(e)}")

def extract_text_from_txt(file_bytes: bytes) -> str:
    try:
        return file_bytes.decode("utf-8", errors="ignore")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TXT extraction failed: {str(e)}")

def extract_text_from_image(file_bytes: bytes) -> str:
    try:
        image = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        return pytesseract.image_to_string(image).strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"OCR failed: {str(e)}")

def detect_language_with_confidence(text: str) -> Dict[str, Any]:
    try:
        sample = text[:2000]
        detected_lang = langdetect.detect(sample)
        lang_probs = langdetect.detect_langs(sample)
        confidence = next((lp.prob for lp in lang_probs if lp.lang == detected_lang), 0.0)
        return {"language": detected_lang, "confidence": round(confidence, 3)}
    except Exception:
        return {"language": "unknown", "confidence": 0.0}

def extract_entities(text: str) -> List[Dict[str, Any]]:
    if not nlp: return []
    try:
        doc = nlp(text)
        return [{"text": ent.text, "label": ent.label_, "start": ent.start_char, "end": ent.end_char} for ent in doc.ents]
    except Exception as e:
        logging.error(f"Entity extraction failed: {e}")
        return []

def calculate_document_stats(text: str) -> Dict[str, Any]:
    words = re.findall(r'\b\w+\b', text)
    sentences = re.split(r"[.!?]+", text)
    return {
        "word_count": len(words), "sentence_count": len([s for s in sentences if s.strip()]),
        "character_count": len(text)
    }

async def translate_text(text: str, source_lang: str, target_lang: str) -> str:
    if not source_lang or source_lang == "unknown" or source_lang == target_lang:
        return text
    try:
        argostranslate.package.update_package_index()
        available_packages = argostranslate.package.get_available_packages()
        
        package_to_install = next(
            filter(
                lambda x: x.from_code == source_lang and x.to_code == target_lang,
                available_packages,
            ),
            None,
        )
        if package_to_install:
            logging.info(f"Downloading translation model for {source_lang} -> {target_lang}")
            argostranslate.package.install_from_path(package_to_install.download())
        
        translated_text = argostranslate.translate.translate(text, source_lang, target_lang)
        return translated_text
    except Exception as e:
        logging.error(f"Local translation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Local translation service failed: {str(e)}")

async def summarize_text(text: str) -> str:
    if not groq_client:
        return "Summarization service is unavailable (Groq client not configured)."
    if not text or len(text.strip()) < 100:
        return "Content is too short to summarize."

    prompt = f"""
    Summarize the following text concisely, focusing on the main ideas and key points.
    Your response should be only the summary itself, without any introductory phrases like "Here is a summary:".

    Text to summarize:
    ---
    {text[:8000]} 
    ---
    """

    try:
        completion = groq_client.chat.completions.create(
            model=GROQ_QA_MODEL,
            messages=[
                {"role": "system", "content": "You are an expert at summarizing documents."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
        )
        return completion.choices[0].message.content
    except Exception as e:
        logging.error(f"Groq summarization failed: {e}")
        raise HTTPException(status_code=500, detail=f"Summarization service error: {e}")


# --- Authentication & User Management ---
def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(authorization: str = Header(None), db: Session = Depends(get_db)):
    credentials_exception = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Could not validate credentials")
    if not authorization or not authorization.startswith("Bearer "):
        raise credentials_exception
    token = authorization.split("Bearer ")[1]
    try:
        payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None: raise credentials_exception
    except JWTError:
        raise credentials_exception
    user = db.query(models.User).filter(models.User.email == email).first()
    if user is None: raise credentials_exception
    return {"id": user.id, "email": user.email, "name": user.name, "picture": user.picture}

@app.post("/auth/google", tags=["Authentication"])
async def auth_google(token_data: Dict[str, str] = Body(...), db: Session = Depends(get_db)):
    if not GOOGLE_CLIENT_ID or not JWT_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Authentication is not configured.")
    try:
        id_info = id_token.verify_oauth2_token(token_data.get("token"), google_requests.Request(), GOOGLE_CLIENT_ID)
        email = id_info['email']
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            user = models.User(email=email, name=id_info.get("name"), picture=id_info.get("picture"))
            db.add(user)
        else:
            user.name, user.picture = id_info.get("name"), id_info.get("picture")
        db.commit()
        db.refresh(user)
        access_token = create_access_token(data={"sub": user.email})
        return {"access_token": access_token, "token_type": "bearer", "user": {"email": user.email, "name": user.name, "picture": user.picture}}
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Invalid Google token: {e}")

@app.get("/me", summary="Get current user info", tags=["Authentication"])
async def read_users_me(current_user: dict = Depends(get_current_user)):
    return current_user

# --- Core Application Endpoints ---
@app.post("/upload", summary="Upload and Process a Document", tags=["Application"])
async def upload_file(
    current_user: dict = Depends(get_current_user),
    file: UploadFile = File(...),
    redact_pii: bool = Form(False),
    db: Session = Depends(get_db)
):
    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File too large. Max size is {MAX_FILE_SIZE // (1024*1024)}MB")
    
    validate_file_extension(file)
    
    file_ext = os.path.splitext(file.filename.lower())[1]
    content_extractor = {
        ".pdf": extract_text_from_pdf, ".docx": extract_text_from_docx, 
        ".txt": extract_text_from_txt, ".png": extract_text_from_image, 
        ".jpg": extract_text_from_image, ".jpeg": extract_text_from_image,
        ".bmp": extract_text_from_image, ".tiff": extract_text_from_image,
    }.get(file_ext)

    if not content_extractor:
        raise HTTPException(status_code=400, detail="Unsupported file type.")

    original_content = content_extractor(file_bytes)
    
    if not original_content or not original_content.strip():
        raise HTTPException(status_code=400, detail="No text could be extracted.")
    
    pii_analysis = analyze_and_redact_pii(original_content, redact=redact_pii)
    text_to_process_and_save = pii_analysis["redacted_text"] if redact_pii else original_content

    analysis_data = {
        "language_detection": detect_language_with_confidence(text_to_process_and_save),
        "statistics": calculate_document_stats(text_to_process_and_save),
        "summary": await summarize_text(text_to_process_and_save),
        "entities": extract_entities(text_to_process_and_save),
        "sentiment": analyze_sentiment(text_to_process_and_save),
        "keywords": extract_keywords(text_to_process_and_save),
        "pii_results": pii_analysis["original_pii"]
    }
    
    new_document = models.Document(
        filename=file.filename,
        original_text=text_to_process_and_save,
        analysis_results=json.dumps(analysis_data),
        owner_id=current_user['id']
    )
    db.add(new_document)
    db.commit()
    db.refresh(new_document)
    
    return JSONResponse({
        "document_id": new_document.id,
        "filename": new_document.filename,
        "original_text": text_to_process_and_save,
        **analysis_data,
        "message": "Document processed successfully"
    })

@app.post("/translate/{document_id}", summary="Translate a document", tags=["Application"])
async def translate_document_on_demand(
    document_id: int, target_lang: str = Form(...),
    current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)
):
    doc = db.query(models.Document).filter(models.Document.id == document_id, models.Document.owner_id == current_user["id"]).first()
    if not doc: raise HTTPException(status_code=404, detail="Document not found.")
    
    analysis = json.loads(doc.analysis_results)
    source_lang = analysis.get("language_detection", {}).get("language", "unknown")
    translated = await translate_text(doc.original_text, source_lang, target_lang)
    
    doc.translated_text = translated
    db.commit()
    return {"translated_text": translated}

@app.post("/qa/{document_id}", summary="Ask a Question", tags=["Application"])
async def ask_question(
    document_id: int, question: str = Form(...),
    current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)
):
    doc = db.query(models.Document).filter(models.Document.id == document_id, models.Document.owner_id == current_user["id"]).first()
    if not doc: raise HTTPException(status_code=404, detail="Document not found.")
    if not groq_client: raise HTTPException(status_code=503, detail="Q&A service unavailable.")
    
    context = doc.translated_text or doc.original_text
    try:
        completion = groq_client.chat.completions.create(
            model=GROQ_QA_MODEL,
            messages=[
                {"role": "system", "content": "Answer based only on the provided context."},
                {"role": "user", "content": f"Context: {context}\n\nQuestion: {question}"}
            ]
        )
        return {"answer": completion.choices[0].message.content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Q&A service error: {e}")

@app.post("/search/{document_id}", summary="Search within a document", tags=["Application"])
async def search_in_document(
    document_id: int,
    query: str = Form(...),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    doc = db.query(models.Document).filter(models.Document.id == document_id, models.Document.owner_id == current_user["id"]).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    content_to_search = doc.translated_text or doc.original_text
    results = []
    
    for match in re.finditer(re.escape(query), content_to_search, re.IGNORECASE):
        start, end = match.start(), match.end()
        snippet_start = max(0, start - 70)
        snippet_end = min(len(content_to_search), end + 70)
        snippet = content_to_search[snippet_start:snippet_end]
        results.append({"snippet": snippet})
        if len(results) >= 10:
            break
            
    return {"results": results}

@app.post("/tts/{document_id}", summary="Generate Text-to-Speech from Document", tags=["Application"])
async def text_to_speech_from_document(
    document_id: int,
    text_type: str = Form(...),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    doc = db.query(models.Document).filter(models.Document.id == document_id, models.Document.owner_id == current_user["id"]).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    text_to_speak = ""
    if text_type == "summary":
        try:
            analysis = json.loads(doc.analysis_results)
            text_to_speak = analysis.get("summary", "")
        except (json.JSONDecodeError, AttributeError):
             raise HTTPException(status_code=500, detail="Could not retrieve summary.")
    elif text_type == "original":
        text_to_speak = doc.translated_text or doc.original_text
    else:
        raise HTTPException(status_code=400, detail="Invalid text_type. Must be 'original' or 'summary'.")

    if not text_to_speak or not text_to_speak.strip():
        raise HTTPException(status_code=400, detail="No text content available to speak.")

    try:
        tts = gTTS(text=text_to_speak, lang='en', slow=False)
        mp3_fp = io.BytesIO()
        tts.write_to_fp(mp3_fp)
        mp3_fp.seek(0)
        return StreamingResponse(mp3_fp, media_type="audio/mpeg")
    except Exception as e:
        logging.error(f"TTS Generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to generate audio: {str(e)}")

@app.post("/quiz/{document_id}", summary="Generate a Quiz from a Document", tags=["Application"])
async def generate_quiz(
    document_id: int,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    doc = db.query(models.Document).filter(models.Document.id == document_id, models.Document.owner_id == current_user["id"]).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    if not groq_client:
        raise HTTPException(status_code=503, detail="Quiz generation service is unavailable.")

    context = doc.original_text
    if not context or len(context.strip()) < 100:
        raise HTTPException(status_code=400, detail="Document content is too short to generate a meaningful quiz.")

    prompt = f"""
    Based on the following text, generate a multiple-choice quiz with 5 questions to test understanding of the key information.
    Return the output as a single, valid JSON object only. Do not include any other text, explanations, or markdown formatting like ```json.
    The JSON object must be a list, where each item in the list is an object with the following exact keys:
    1. "question": A string containing the question.
    2. "options": A list of 4 strings representing the possible answers.
    3. "correct_answer": A string that exactly matches one of the items in the "options" list.

    Text:
    ---
    {context[:4000]}
    ---
    """
    try:
        completion = groq_client.chat.completions.create(
            model=GROQ_QA_MODEL,
            messages=[
                {"role": "system", "content": "You are an expert quiz creator. Your response must be only a valid JSON object based on the user's request."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
        )
        
        raw_response = completion.choices[0].message.content
        json_response_match = re.search(r'\[.*\]', raw_response, re.DOTALL)
        if not json_response_match:
            raise ValueError("LLM did not return a valid JSON list.")
        
        json_string = json_response_match.group(0)
        quiz_data = json.loads(json_string)

        if not isinstance(quiz_data, list) or not all('question' in q and 'options' in q and 'correct_answer' in q for q in quiz_data):
             raise ValueError("LLM returned JSON with incorrect structure.")

        return {"quiz": quiz_data}
    except json.JSONDecodeError:
        logging.error(f"Failed to parse JSON from LLM response: {raw_response}")
        raise HTTPException(status_code=500, detail="Failed to generate a valid quiz. The AI response was not in the correct format.")
    except (Exception, ValueError) as e:
        logging.error(f"Quiz generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"An error occurred while generating the quiz: {e}")


@app.delete("/documents/{document_id}", summary="Delete a document", tags=["Application"], status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(document_id: int, current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.query(models.Document).filter(models.Document.id == document_id, models.Document.owner_id == current_user["id"]).first()
    if doc:
        db.delete(doc)
        db.commit()

@app.delete("/documents/history/clear", summary="Clear history", tags=["Application"], status_code=status.HTTP_204_NO_CONTENT)
async def clear_history(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    db.query(models.Document).filter(models.Document.owner_id == current_user["id"]).delete()
    db.commit()

@app.get("/documents/history", summary="Get history", tags=["Application"])
async def get_history(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    return db.query(models.Document).filter(models.Document.owner_id == current_user["id"]).order_by(models.Document.created_at.desc()).limit(10).all()