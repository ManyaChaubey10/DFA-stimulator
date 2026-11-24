from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from .automata import (DfaValidationError, RegexError, build_dfa, minimize_dfa, shortest_counterexample, simulate, validate_dfa)
from .natural_language import (
    build_dfa_from_description, explain_ast, interpret_description, validate_alphabet,
)

app = FastAPI(title="DFA Studio API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

REQUIRED_ROUTES = {
    ("GET", "/health"),
    ("POST", "/api/interpret"),
    ("POST", "/api/dfa"),
    ("POST", "/api/dfa/natural"),
    ("POST", "/api/simulate"),
    ("POST", "/api/check"),
}

def route_readiness() -> dict:
    available = {
        (method, route.path)
        for route in app.routes
        for method in getattr(route, "methods", set())
    }
    missing = sorted(f"{method} {path}" for method, path in REQUIRED_ROUTES - available)
    return {"status": "ok" if not missing else "degraded", "required_routes": sorted(
        f"{method} {path}" for method, path in REQUIRED_ROUTES
    ), "missing_routes": missing}

@app.on_event("startup")
def verify_required_routes_at_startup():
    readiness = route_readiness()
    if readiness["missing_routes"]:
        raise RuntimeError("Required DFA API routes are missing: " + ", ".join(readiness["missing_routes"]))

class GenerateRequest(BaseModel):
    alphabet: list[str] = Field(min_length=1)
    expression: str = Field(min_length=1, max_length=200)

class NaturalLanguageRequest(BaseModel):
    alphabet: list[str] = Field(min_length=1)
    description: str = Field(min_length=1, max_length=500)
    ast: dict | None = None

class InterpretRequest(BaseModel):
    alphabet: list[str] = Field(min_length=1)
    description: str = Field(min_length=1, max_length=500)

class SimulateRequest(BaseModel):
    dfa: dict
    input: str = Field(max_length=500)

class CheckRequest(BaseModel):
    mode: str
    alphabet: list[str] = Field(min_length=1)
    expression: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=500)
    dfa: dict

@app.get("/")
def root():
    return {"service": "DFA Studio API", "status": "ok", "docs": "/docs", "health": "/health", "frontend": "http://localhost:5173"}

@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(status_code=204)

@app.get("/health")
@app.get("/api/health", include_in_schema=False)
def health():
    return route_readiness()

@app.post("/api/dfa")
def generate(request: GenerateRequest):
    try:
        original = build_dfa(request.expression, request.alphabet)
        return {**original, "minimized_dfa": minimize_dfa(original)}
    except RegexError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

@app.post("/api/dfa/natural")
def generate_from_description(request: NaturalLanguageRequest):
    try:
        symbols = validate_alphabet(request.alphabet)
        ast, source = interpret_description(request.description, symbols) if request.ast is None else (request.ast, "user-edited")
        original = build_dfa_from_description(request.description, symbols, ast)
        original["interpretation_source"] = source
        original["interpretation_explanation"] = explain_ast(original["interpreted_ast"])
        return {**original, "minimized_dfa": minimize_dfa(original)}
    except RegexError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

@app.post("/api/interpret")
def interpret_language(request: InterpretRequest):
    try:
        ast, source = interpret_description(request.description, validate_alphabet(request.alphabet))
        return {"ast": ast, "explanation": explain_ast(ast), "source": source}
    except RegexError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

@app.post("/api/simulate")
def run_simulation(request: SimulateRequest):
    try:
        return simulate(request.dfa, request.input)
    except (RegexError, KeyError, TypeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/check")
def check_student_dfa(request: CheckRequest):
    """Compare a student's DFA to the requested language by product-automaton BFS."""
    try:
        student = validate_dfa(request.dfa, request.alphabet)
    except RegexError as error:
        raise HTTPException(status_code=422, detail=f"Student DFA validation failed: {error}") from error

    try:
        if request.mode == "regex":
            if not request.expression:
                raise DfaValidationError("Enter a regular expression to check against.")
            reference = build_dfa(request.expression, request.alphabet)
        elif request.mode == "natural":
            if not request.description:
                raise DfaValidationError("Enter a plain-English language description to check against.")
            reference = build_dfa_from_description(request.description, request.alphabet)
        else:
            raise DfaValidationError("Choose regex or natural-language question mode.")
        counterexample = shortest_counterexample(student, reference)
    except RegexError as error:
        return {"available": False, "message": f"Verification unavailable: {error}"}
    if counterexample is None:
        return {"available": True, "equivalent": True, "message": "Your DFA is correct: it recognizes the specified language."}
    return {
        "available": True, "equivalent": False, "counterexample": counterexample,
        "student_result": simulate(student, counterexample),
        "expected_result": simulate(reference, counterexample),
        "message": "Your DFA is incorrect. The counterexample below is the shortest string on which the results differ.",
    }
