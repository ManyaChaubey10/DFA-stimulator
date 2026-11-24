"""Natural-language interpretation and AST-to-DFA compilation.

The language model (when configured) returns only a small, validated AST. All
states and transitions are constructed locally by this module.
"""
from __future__ import annotations

import json
import os
import re
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from .automata import RegexError, minimize_dfa


class InterpretationError(RegexError):
    """The description could not be interpreted without guessing."""


class NonRegularLanguageError(InterpretationError):
    """The description explicitly specifies a language that no DFA can recognize."""


def _reject_known_non_regular(description: str, alphabet: list[str]) -> None:
    notation = re.fullmatch(
        r"\s*\{\s*([A-Za-z])\s*\^\s*n\s*([A-Za-z])\s*\^\s*n\s*\|\s*n\s*(?:>=|=|\u2265)\s*0\s*\}\s*",
        description,
    )
    phrase = re.search(
        r"(?:equal|same)\s+(?:number|count)\s+of\s+([a-z])(?:['’]?s)?\s+(?:followed\s+by|then)\s+([a-z])(?:['’]?s)?",
        description,
        re.I,
    )
    pair = notation.groups() if notation else phrase.groups() if phrase else None
    if pair and pair[0].lower() != pair[1].lower() and all(symbol.lower() in {a.lower() for a in alphabet} for symbol in pair):
        raise NonRegularLanguageError(
            f"{description.strip()} specifies equal counts of two different symbols in a linked order, a known non-regular language. A DFA cannot recognize it; a pushdown automaton or a different model is required."
        )


def validate_alphabet(alphabet: list[str]) -> list[str]:
    symbols = [str(symbol).strip() for symbol in alphabet if str(symbol).strip()]
    if not symbols:
        raise RegexError("Add at least one input symbol to the alphabet.")
    if any(len(symbol) != 1 for symbol in symbols):
        raise RegexError("Natural-language DFA generation supports single-character alphabet symbols.")
    if len(set(symbols)) != len(symbols):
        raise RegexError("The alphabet must not contain duplicate symbols.")
    return symbols


def validate_ast(node: object, alphabet: list[str], depth: int = 0) -> dict:
    """Validate a closed AST schema; unknown keys and operations are rejected."""
    if depth > 12 or not isinstance(node, dict):
        raise InterpretationError("The interpreted constraints have an invalid AST shape or are too deeply nested.")
    op = node.get("op")
    if op == "clarify" and set(node) == {"op", "question"} and isinstance(node["question"], str):
        raise InterpretationError("Clarification needed: " + node["question"])
    schemas = {
        "starts_with": {"op", "pattern"}, "ends_with": {"op", "pattern"},
        "contains": {"op", "pattern"}, "avoids": {"op", "pattern"},
        "count_mod": {"op", "symbol", "modulus", "remainder"},
        "count_exact": {"op", "symbol", "count"}, "count_at_least": {"op", "symbol", "count"},
        "count_at_most": {"op", "symbol", "count"},
        "position_from_left": {"op", "position", "symbol"},
        "position_from_right": {"op", "position", "symbol"},
        "length_mod": {"op", "modulus", "remainder"},
        "AND": {"op", "args"}, "OR": {"op", "args"}, "NOT": {"op", "arg"},
    }
    if op not in schemas:
        raise InterpretationError(f"Unsupported AST operation: {op!r}.")
    if set(node) != schemas[op]:
        raise InterpretationError(f"The {op} constraint has missing or unexpected fields.")
    result = dict(node)
    if op in {"starts_with", "ends_with", "contains", "avoids"}:
        pattern = result["pattern"]
        if not isinstance(pattern, str) or not pattern or any(c not in alphabet for c in pattern):
            raise InterpretationError("A pattern must be non-empty and use only symbols in the input alphabet.")
    if op in {"count_mod", "count_exact", "count_at_least", "count_at_most", "position_from_left", "position_from_right"}:
        if not isinstance(result["symbol"], str) or result["symbol"] not in alphabet:
            raise InterpretationError(f"Symbol {result['symbol']!r} is not in the input alphabet.")
    numeric = {"modulus": (1, 50), "remainder": (0, 49), "count": (0, 200), "position": (1, 30)}
    for key, (low, high) in numeric.items():
        if key in result and (type(result[key]) is not int or not low <= result[key] <= high):
            raise InterpretationError(f"{key} must be an integer from {low} to {high}.")
    if op in {"count_mod", "length_mod"} and result["remainder"] >= result["modulus"]:
        raise InterpretationError("A modulo remainder must be smaller than its modulus.")
    if op in {"AND", "OR"}:
        if not isinstance(result["args"], list) or len(result["args"]) < 2 or len(result["args"]) > 8:
            raise InterpretationError(f"{op} requires between two and eight constraints.")
        result["args"] = [validate_ast(arg, alphabet, depth + 1) for arg in result["args"]]
    if op == "NOT":
        result["arg"] = validate_ast(result["arg"], alphabet, depth + 1)
    return result


def _combine(op: str, args: list[dict]) -> dict:
    return args[0] if len(args) == 1 else {"op": op, "args": args}


def interpret_deterministic(description: str, alphabet: list[str]) -> dict:
    """Conservative grammar for common formal-language descriptions."""
    raw = description.strip().rstrip(" .")
    if not raw:
        raise InterpretationError("Enter a plain-English language description.")
    text = re.sub(r"^(?:the )?(?:language of )?", "", raw, flags=re.I).strip()
    text = re.sub(r"^(?:all )?(?:binary )?strings?\s+", "", text, flags=re.I)
    text = re.sub(r"^(?:that|which|whose)\s+", "", text, flags=re.I)

    # Boolean syntax is deliberately parsed at phrase boundaries only.
    pieces = re.split(r"\s+(and|or|but)\s+", text, flags=re.I)
    connectors = [pieces[i].lower() for i in range(1, len(pieces), 2)]
    phrases = pieces[::2]
    if len(phrases) > 1:
        operators={"OR" if connector=="or" else "AND" for connector in connectors}
        if len(operators)>1:
            raise InterpretationError("This description mixes ‘and’ and ‘or’ without grouping. Add parentheses by editing the AST, or restate the intended grouping.")
        clauses = []
        for piece in phrases:
            negative = bool(re.match(r"(?:not|never)\s+", piece, re.I))
            if negative:
                piece = re.sub(r"^(?:not|never)\s+", "", piece, flags=re.I)
                bare_pattern = re.fullmatch(r"(?:containing|contain|the substring)?\s*([\w]+)", piece, re.I)
                if bare_pattern:
                    clauses.append({"op":"avoids", "pattern":bare_pattern.group(1)})
                    continue
            clause = interpret_deterministic(piece, alphabet)
            clauses.append({"op": "NOT", "arg": clause} if negative else clause)
        return _combine(operators.pop(), clauses)

    m = re.fullmatch(r"(?:(?:with|have|has|contain|contains|containing)\s+)?(?:an?\s+)?(even|odd)\s+(?:number|count)\s+of\s+([\w])s?", text, re.I)
    if m:
        parity, symbol = m.groups()
        return {"op":"count_mod", "symbol":symbol, "modulus":2, "remainder":0 if parity.lower()=="even" else 1}
    m = re.fullmatch(r"(?:whose\s+)?(?:number|count)\s+of\s+([\w])s?\s+is\s+(even|odd)", text, re.I)
    if m:
        symbol, parity = m.groups()
        return {"op":"count_mod", "symbol":symbol, "modulus":2, "remainder":0 if parity.lower()=="even" else 1}
    number=r"(\d+|zero|one|two|three|four|five|six|seven|eight|nine|ten)"
    number_value=lambda value: int(value) if value.isdigit() else {"zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10}[value.lower()]
    m = re.fullmatch(r"(?:(?:contain(?:ing|s)?|have?|with)\s+)?exactly\s+"+number+r"\s+([\w])s?", text, re.I)
    if m:
        count, symbol=m.groups(); return {"op":"count_exact", "symbol":symbol, "count":number_value(count)}
    m = re.fullmatch(r"(?:(?:contain(?:ing|s)?|have?|with)\s+)?(?:at\s+least|no\s+fewer\s+than)\s+"+number+r"\s+([\w])s?", text, re.I)
    if m:
        count, symbol=m.groups(); return {"op":"count_at_least", "symbol":symbol, "count":number_value(count)}
    m = re.fullmatch(r"(?:(?:contain(?:ing|s)?|have?|with)\s+)?(?:at\s+most|no\s+more\s+than)\s+"+number+r"\s+([\w])s?", text, re.I)
    if m:
        count, symbol=m.groups(); return {"op":"count_at_most", "symbol":symbol, "count":number_value(count)}
    m = re.fullmatch(r"(?:whose\s+)?length\s+(?:is\s+)?(?:divisible\s+by\s+(\d+)|(?:a\s+)?multiple\s+of\s+(\d+))", text, re.I)
    if m:
        return {"op":"length_mod", "modulus":int(m.group(1) or m.group(2)), "remainder":0}
    m = re.fullmatch(r"(?:whose\s+)?length\s+(?:is\s+)?(?:congruent\s+to\s+(\d+)\s+mod(?:ulo)?\s+(\d+)|(?:equal\s+to\s+)?(\d+)\s*(?:mod|%)\s*(\d+))", text, re.I)
    if m:
        vals=m.groups(); return {"op":"length_mod", "remainder":int(vals[0] or vals[2]), "modulus":int(vals[1] or vals[3])}
    m = re.fullmatch(r"(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+symbol\s+from\s+(?:the\s+)?(left|right)\s+(?:is|must\s+be)\s+([\w])", text, re.I)
    if m:
        pos, side, symbol=m.groups(); return {"op":f"position_from_{side.lower()}", "position":int(pos), "symbol":symbol}
    m=re.fullmatch(r"(first|second|third|fourth|fifth)(?:-to-last|\s+to\s+last)\s+symbol\s+(?:is|must\s+be)\s+([\w])",text,re.I)
    if m:
        pos={"first":1,"second":2,"third":3,"fourth":4,"fifth":5}[m.group(1).lower()]
        return {"op":"position_from_right","position":pos,"symbol":m.group(2)}
    m = re.fullmatch(r"(?:the\s+)?(first|second|third)\s+symbol\s+from\s+(?:the\s+)?(left|right)\s+(?:is|must\s+be)\s+([\w])", text, re.I)
    if m:
        pos={"first":1,"second":2,"third":3}[m.group(1).lower()]; side=m.group(2).lower()
        return {"op":f"position_from_{side}", "position":pos, "symbol":m.group(3)}
    patterns = [
        (r"(?:start|starts|starting|begin|begins|beginning)\s+(?:with|in)\s+([\w]+)", "starts_with"),
        (r"(?:end|ends|ending)\s+(?:with|in)\s+([\w]+)", "ends_with"),
        (r"(?:contain|contains|containing)\s+([\w]+)", "contains"),
        (r"(?:do\s+not\s+contain|don't\s+contain|does\s+not\s+contain|without|avoiding|avoid|not\s+containing)\s+([\w]+)", "avoids"),
    ]
    for pattern, op in patterns:
        m=re.fullmatch(pattern,text,re.I)
        if m: return {"op":op,"pattern":m.group(1)}
    m=re.fullmatch(r"(?:with\s+)?no\s+consecutive\s+([\w])s?",text,re.I)
    if m: return {"op":"avoids","pattern":m.group(1)*2}
    raise InterpretationError(
        f"I couldn't interpret '{raw}' deterministically. Configure an LLM provider for broader wording, "
        "or use explicit forms such as ‘second symbol from the right is 1’, ‘exactly three 1s’, "
        "‘length divisible by 3’, ‘starts with 0’, or ‘contains 101’."
    )


def _ast_schema() -> dict:
    fields={
        "starts_with":{"pattern":{"type":"string"}}, "ends_with":{"pattern":{"type":"string"}},
        "contains":{"pattern":{"type":"string"}}, "avoids":{"pattern":{"type":"string"}},
        "count_mod":{"symbol":{"type":"string"},"modulus":{"type":"integer"},"remainder":{"type":"integer"}},
        "length_mod":{"modulus":{"type":"integer"},"remainder":{"type":"integer"}},
        "count_exact":{"symbol":{"type":"string"},"count":{"type":"integer"}},
        "count_at_least":{"symbol":{"type":"string"},"count":{"type":"integer"}},
        "count_at_most":{"symbol":{"type":"string"},"count":{"type":"integer"}},
        "position_from_left":{"position":{"type":"integer"},"symbol":{"type":"string"}},
        "position_from_right":{"position":{"type":"integer"},"symbol":{"type":"string"}},
        "AND":{"args":{"type":"array","minItems":2,"maxItems":8,"items":{"$ref":"#/$defs/constraint"}}},
        "OR":{"args":{"type":"array","minItems":2,"maxItems":8,"items":{"$ref":"#/$defs/constraint"}}},
        "NOT":{"arg":{"$ref":"#/$defs/constraint"}},
        "clarify":{"question":{"type":"string"}},
    }
    branches=[]
    for op, properties in fields.items():
        props={"op":{"type":"string","const":op},**properties}
        branches.append({"type":"object","additionalProperties":False,"properties":props,"required":list(props)})
    return {"$defs":{"constraint":{"anyOf":branches}},"$ref":"#/$defs/constraint"}


AST_SCHEMA = _ast_schema()


def _llm_interpret(description: str, alphabet: list[str]) -> dict:
    key=os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not key: raise InterpretationError("No deterministic interpretation matched and no LLM credentials are configured. Configure LLM_API_KEY (or OPENAI_API_KEY) and LLM_BASE_URL/LLM_MODEL for broader descriptions.")
    base=os.getenv("LLM_BASE_URL","https://api.openai.com/v1").rstrip("/")
    model=os.getenv("LLM_MODEL","gpt-4o-mini")
    provider=os.getenv("LLM_PROVIDER","openai-compatible")
    if provider not in {"openai-compatible","openai"}: raise InterpretationError(f"Unsupported LLM_PROVIDER '{provider}'. Use openai-compatible or openai.")
    system=("Interpret the request as a regular language over the supplied finite alphabet. Return only a JSON AST using the given schema. "
            "Never return states or transitions. If the request is ambiguous, unsupported, or not a regular-language constraint, return {\"op\":\"clarify\",\"question\":\"brief clarification\"}. "
            "Position numbers are one-based. A count_mod constraint means count(symbol) modulo modulus equals remainder.")
    payload={"model":model,"messages":[{"role":"system","content":system},{"role":"user","content":json.dumps({"alphabet":alphabet,"description":description})}],
             "response_format":{"type":"json_schema","json_schema":{"name":"language_ast","strict":True,"schema":AST_SCHEMA}}}
    request=Request(base+"/chat/completions",data=json.dumps(payload).encode(),headers={"Authorization":"Bearer "+key,"Content-Type":"application/json"},method="POST")
    try:
        with urlopen(request,timeout=25) as response: body=json.loads(response.read())
        content=body["choices"][0]["message"]["content"]
        result=json.loads(content)
    except HTTPError as error:
        raise InterpretationError(f"Language interpretation service returned HTTP {error.code}. Check the API key, model, and provider URL.") from error
    except Exception as error:
        raise InterpretationError(f"Language interpretation service failed: {error.__class__.__name__}. Check provider settings and try again.") from error
    return result


def interpret_description(description: str, alphabet: list[str]) -> tuple[dict,str]:
    _reject_known_non_regular(description, alphabet)
    try:
        ast=interpret_deterministic(description,alphabet); source="deterministic"
    except InterpretationError as deterministic_error:
        if not (os.getenv("LLM_API_KEY") or os.getenv("OPENAI_API_KEY")): raise deterministic_error
        ast=_llm_interpret(description,alphabet); source="llm"
    return validate_ast(ast,alphabet),source


def _matcher(pattern: str, alphabet: list[str], kind: str) -> dict:
    m=len(pattern); states=list(range(m+1)); dead=m+1
    if kind=="starts_with": states.append(dead)
    transitions={s:{} for s in states}
    for state in states:
        for symbol in alphabet:
            if kind=="starts_with":
                target=dead if state==dead else (m if state==m else state+1 if symbol==pattern[state] else dead)
            elif kind=="contains" and state==m: target=m
            elif kind=="avoids" and state==m: target=m
            else:
                candidate=pattern[:state]+symbol
                target=max(i for i in range(min(m,len(candidate))+1) if candidate.endswith(pattern[:i]))
            transitions[state][symbol]=target
    accepting={m} if kind in {"starts_with","ends_with","contains"} else set(states)-{m}
    return {"states":states,"start":0,"accepting":accepting,"transitions":transitions}


def _atomic_dfa(ast: dict, alphabet: list[str]) -> dict:
    op=ast["op"]
    if op in {"starts_with","ends_with","contains","avoids"}:
        return _matcher(ast["pattern"],alphabet,op)
    if op in {"count_mod","length_mod"}:
        modulus=ast["modulus"]; symbol=ast.get("symbol"); states=list(range(modulus))
        trans={s:{a:(s+1)%modulus if (op=="length_mod" or a==symbol) else s for a in alphabet} for s in states}
        return {"states":states,"start":0,"accepting":{ast["remainder"]},"transitions":trans}
    if op in {"count_exact","count_at_least","count_at_most"}:
        count=ast["count"]; overflow=count+1
        states=list(range(count+1)) + ([overflow] if op!="count_at_least" else [])
        trans={s:{a:(min(count,s+1) if op=="count_at_least" else overflow if s==overflow else min(overflow,s+1)) if a==ast["symbol"] else s for a in alphabet} for s in states}
        accepted={count} if op=="count_exact" else set(range(count,count+1)) if op=="count_at_least" else set(range(count+1))
        return {"states":states,"start":0,"accepting":accepted,"transitions":trans}
    if op=="position_from_left":
        position=ast["position"]; dead=position+1; states=list(range(position+1))+[dead]; trans={s:{} for s in states}
        for s in states:
            for a in alphabet:
                trans[s][a]=dead if s==dead else (s+1 if a==ast["symbol"] else dead) if s==position-1 else (position if s==position else s+1)
        return {"states":states,"start":0,"accepting":{position},"transitions":trans}
    if op=="position_from_right":
        k=ast["position"]
        # State is the last at most k symbols. This is finite and exact.
        tuples=[()]; ids={():0}; trans={}; cursor=0
        while cursor<len(tuples):
            suffix=tuples[cursor]; row={}
            for a in alphabet:
                nxt=(suffix+(a,))[-k:]
                if nxt not in ids: ids[nxt]=len(tuples);tuples.append(nxt)
                row[a]=ids[nxt]
            trans[cursor]=row;cursor+=1
            if len(tuples)>5000: raise RegexError("The positional constraint requires over 5,000 states; use a smaller position or alphabet.")
        accepting={i for i,suffix in enumerate(tuples) if len(suffix)==k and suffix[0]==ast["symbol"]}
        return {"states":list(range(len(tuples))),"start":0,"accepting":accepting,"transitions":trans}
    raise InterpretationError(f"Cannot compile operation {op!r}.")


def _product(left: dict, right: dict, alphabet: list[str], op: str) -> dict:
    start=(left["start"],right["start"]); states=[start]; indexes={start:0}; transitions={}; accepts=[]; cursor=0
    while cursor<len(states):
        pair=states[cursor]; source=cursor; transitions[source]={}
        la=pair[0] in left["accepting"]; ra=pair[1] in right["accepting"]
        if (la and ra) if op=="AND" else (la or ra): accepts.append(source)
        for symbol in alphabet:
            dest=(left["transitions"][pair[0]][symbol],right["transitions"][pair[1]][symbol])
            if dest not in indexes:
                if len(states)>=5000: raise RegexError("Boolean combination exceeds the 5,000-state construction limit.")
                indexes[dest]=len(states);states.append(dest)
            transitions[source][symbol]=indexes[dest]
        cursor+=1
    return {"states":list(range(len(states))),"start":0,"accepting":set(accepts),"transitions":transitions}


def _compile_ast(ast: dict, alphabet: list[str]) -> dict:
    op=ast["op"]
    if op=="NOT":
        dfa=_compile_ast(ast["arg"],alphabet)
        dfa["accepting"]=set(dfa["states"])-set(dfa["accepting"])
        return dfa
    if op in {"AND","OR"}:
        machines=[_compile_ast(arg,alphabet) for arg in ast["args"]]
        result=machines[0]
        for machine in machines[1:]: result=_product(result,machine,alphabet,op)
        return result
    return _atomic_dfa(ast,alphabet)


def compile_ast(ast: object, alphabet: list[str], description: str="") -> dict:
    symbols=validate_alphabet(alphabet); valid=validate_ast(ast,symbols)
    machine=_compile_ast(valid,symbols)
    states=[f"q{i}" for i in machine["states"]]
    transitions={f"q{s}":{symbol:f"q{d}" for symbol,d in row.items()} for s,row in machine["transitions"].items()}
    dfa={"states":states,"alphabet":symbols,"transitions":transitions,"start_state":"q0",
         "accepting_states":[f"q{s}" for s in machine["states"] if s in machine["accepting"]],
         "expression":"","description":description,"interpreted_ast":valid,"complete":True}
    # Validate complete deterministic transition function before exposing it.
    if set(transitions)!=(set(states)) or any(set(transitions[s])!=set(symbols) or any(t not in states for t in transitions[s].values()) for s in states):
        raise RegexError("Internal compiler validation failed: the DFA transition function is not complete.")
    return dfa


def explain_ast(ast: dict) -> str:
    op=ast["op"]
    if op in {"starts_with","ends_with","contains","avoids"}:
        verbs={"starts_with":"starts with","ends_with":"ends with","contains":"contains","avoids":"does not contain"}
        return f"String {verbs[op]} {ast['pattern']}"
    if op=="count_mod": return f"The count of {ast['symbol']} is congruent to {ast['remainder']} modulo {ast['modulus']}"
    if op=="length_mod": return f"String length is congruent to {ast['remainder']} modulo {ast['modulus']}"
    if op in {"count_exact","count_at_least","count_at_most"}:
        phrase={"count_exact":"exactly","count_at_least":"at least","count_at_most":"at most"}[op]
        return f"The count of {ast['symbol']} is {phrase} {ast['count']}"
    if op.startswith("position_from_"): return f"The {ast['position']}th symbol from the {op.rsplit('_',1)[1]} is {ast['symbol']}"
    if op=="NOT": return "Not ("+explain_ast(ast["arg"])+")"
    joiner=" and " if op=="AND" else " or "
    return "("+joiner.join(explain_ast(item) for item in ast["args"])+")"


def build_dfa_from_description(description: str, alphabet: list[str], ast: object|None=None) -> dict:
    symbols=validate_alphabet(alphabet)
    if ast is None: ast,_source=interpret_description(description,symbols)
    return compile_ast(ast,symbols,description)

