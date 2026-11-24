from __future__ import annotations

from dataclasses import dataclass
from typing import TypeAlias


class RegexError(ValueError):
    pass


@dataclass
class NFA:
    start: int
    accept: int
    transitions: dict[int, dict[str | None, set[int]]]

    def add(self, source: int, symbol: str | None, target: int) -> None:
        self.transitions.setdefault(source, {}).setdefault(symbol, set()).add(target)
        self.transitions.setdefault(target, {})


class RegexParser:
    """Recursive-descent parser and Thompson NFA builder for a small regex subset."""

    def __init__(self, expression: str, alphabet: list[str]):
        self.expression = expression.replace(" ", "")
        self.alphabet = set(alphabet)
        self.position = 0
        self.next_state = 0

    def state(self) -> int:
        result = self.next_state
        self.next_state += 1
        return result

    def parse(self) -> NFA:
        if not self.expression:
            raise RegexError("Enter a regular expression.")
        nfa = self.union()
        if self.position != len(self.expression):
            raise RegexError(f"Unexpected character '{self.expression[self.position]}' at position {self.position + 1}.")
        return nfa

    def union(self) -> NFA:
        left = self.concat()
        while self.peek() == "|":
            self.position += 1
            right = self.concat()
            start, accept = self.state(), self.state()
            result = NFA(start, accept, {})
            self.merge(result, left); self.merge(result, right)
            result.add(start, None, left.start); result.add(start, None, right.start)
            result.add(left.accept, None, accept); result.add(right.accept, None, accept)
            left = result
        return left

    def concat(self) -> NFA:
        parts: list[NFA] = []
        while self.peek() is not None and self.peek() not in ")|":
            parts.append(self.repeat())
        if not parts:
            raise RegexError("Expected a symbol or parenthesized expression.")
        result = parts[0]
        for part in parts[1:]:
            self.merge(result, part)
            result.add(result.accept, None, part.start)
            result.accept = part.accept
        return result

    def repeat(self) -> NFA:
        result = self.atom()
        while self.peek() in ("*", "+", "?"):
            operator = self.take()
            start, accept = self.state(), self.state()
            wrapped = NFA(start, accept, {})
            self.merge(wrapped, result)
            wrapped.add(start, None, result.start)
            wrapped.add(result.accept, None, accept)
            if operator in ("*", "?"):
                wrapped.add(start, None, accept)
            if operator in ("*", "+"):
                wrapped.add(result.accept, None, result.start)
            result = wrapped
        return result

    def atom(self) -> NFA:
        token = self.peek()
        if token is None:
            raise RegexError("Expression ends where a symbol was expected.")
        if token == "(":
            self.position += 1
            result = self.union()
            if self.peek() != ")":
                raise RegexError("Missing closing parenthesis.")
            self.position += 1
            return result
        if token == "ε":
            self.position += 1
            start, accept = self.state(), self.state()
            result = NFA(start, accept, {}); result.add(start, None, accept)
            return result
        if token == "∅":
            self.position += 1
            start, accept = self.state(), self.state()
            return NFA(start, accept, {start: {}, accept: {}})
        if token in "*+?)|":
            raise RegexError(f"Unexpected operator '{token}'.")
        self.position += 1
        if token not in self.alphabet:
            raise RegexError(f"Symbol '{token}' is not in the input alphabet.")
        start, accept = self.state(), self.state()
        result = NFA(start, accept, {}); result.add(start, token, accept)
        return result

    def peek(self) -> str | None:
        return self.expression[self.position] if self.position < len(self.expression) else None

    def take(self) -> str:
        token = self.peek()
        if token is None:
            raise RegexError("Unexpected end of expression.")
        self.position += 1
        return token

    @staticmethod
    def merge(target: NFA, source: NFA) -> None:
        for state, edges in source.transitions.items():
            target.transitions.setdefault(state, {})
            for symbol, destinations in edges.items():
                target.transitions[state].setdefault(symbol, set()).update(destinations)


def epsilon_closure(nfa: NFA, states: set[int]) -> frozenset[int]:
    closure = set(states)
    stack = list(states)
    while stack:
        for destination in nfa.transitions.get(stack.pop(), {}).get(None, set()):
            if destination not in closure:
                closure.add(destination); stack.append(destination)
    return frozenset(closure)


def build_dfa(expression: str, alphabet: list[str]) -> dict:
    alphabet = [symbol.strip() for symbol in alphabet if symbol.strip()]
    if not alphabet:
        raise RegexError("Add at least one input symbol to the alphabet.")
    if any(len(symbol) != 1 for symbol in alphabet):
        raise RegexError("This MVP supports single-character alphabet symbols (for example: 0, 1).")
    if len(set(alphabet)) != len(alphabet):
        raise RegexError("The alphabet must not contain duplicate symbols.")
    if any(symbol in "()|*+?ε∅" for symbol in alphabet):
        raise RegexError("Alphabet symbols cannot use regex operators or ε/∅.")
    nfa = RegexParser(expression, alphabet).parse()
    initial = epsilon_closure(nfa, {nfa.start})
    subsets = [initial]
    indices = {initial: 0}
    transitions: dict[str, dict[str, str]] = {}
    cursor = 0
    while cursor < len(subsets):
        subset = subsets[cursor]
        source = f"q{cursor}"
        transitions[source] = {}
        for symbol in alphabet:
            moved: set[int] = set()
            for state in subset:
                moved.update(nfa.transitions.get(state, {}).get(symbol, set()))
            target_set = epsilon_closure(nfa, moved)
            if target_set not in indices:
                indices[target_set] = len(subsets); subsets.append(target_set)
            transitions[source][symbol] = f"q{indices[target_set]}"
        cursor += 1
    accepting = [f"q{i}" for i, subset in enumerate(subsets) if nfa.accept in subset]
    states = [f"q{i}" for i in range(len(subsets))]
    return {"states": states, "alphabet": alphabet, "transitions": transitions,
            "start_state": "q0", "accepting_states": accepting,
            "expression": expression, "complete": True}


def minimize_dfa(dfa: dict) -> dict:
    """Return an equivalent minimal complete DFA using partition refinement.

    Unreachable states are discarded first. Partitions begin with accepting and
    rejecting states, then split until every state's destinations agree by block.
    """
    states = list(dfa["states"])
    alphabet = list(dfa["alphabet"])
    transitions = dfa["transitions"]
    start = dfa["start_state"]
    accepting = set(dfa["accepting_states"])

    # Restrict minimization to states reachable from the initial state.
    reachable = {start}
    pending = [start]
    while pending:
        state = pending.pop()
        for symbol in alphabet:
            target = transitions[state][symbol]
            if target not in reachable:
                reachable.add(target)
                pending.append(target)
    ordered = [state for state in states if state in reachable]

    partitions = [block for block in (
        [state for state in ordered if state not in accepting],
        [state for state in ordered if state in accepting],
    ) if block]

    while True:
        block_for = {state: index for index, block in enumerate(partitions) for state in block}
        refined: list[list[str]] = []
        changed = False
        for block in partitions:
            groups: dict[tuple[int, ...], list[str]] = {}
            for state in block:
                signature = tuple(block_for[transitions[state][symbol]] for symbol in alphabet)
                groups.setdefault(signature, []).append(state)
            refined.extend(groups.values())
            changed |= len(groups) > 1
        partitions = refined
        if not changed:
            break

    # Put the initial-state class first, then preserve original state order.
    order_index = {state: index for index, state in enumerate(ordered)}
    partitions.sort(key=lambda block: (0 if start in block else 1, min(order_index[s] for s in block)))
    names = {state: f"q{index}" for index, block in enumerate(partitions) for state in block}
    minimized_states = [f"q{index}" for index in range(len(partitions))]
    minimized_transitions: dict[str, dict[str, str]] = {}
    minimized_accepting: list[str] = []

    for index, block in enumerate(partitions):
        new_state = f"q{index}"
        representative = block[0]
        minimized_transitions[new_state] = {
            symbol: names[transitions[representative][symbol]] for symbol in alphabet
        }
        if any(state in accepting for state in block):
            minimized_accepting.append(new_state)

    return {
        "states": minimized_states,
        "alphabet": alphabet,
        "transitions": minimized_transitions,
        "start_state": names[start],
        "accepting_states": minimized_accepting,
        "expression": dfa.get("expression", ""),
        "description": dfa.get("description", ""),
        "complete": True,
        "minimized": True,
        "original_state_count": len(states),
    }


def simulate(dfa: dict, value: str) -> dict:
    state = dfa["start_state"]
    steps = [{"index": 0, "symbol": "", "from_state": None, "to_state": state, "note": "Start"}]
    for index, symbol in enumerate(value, 1):
        if symbol not in dfa["alphabet"]:
            raise RegexError(f"Input symbol '{symbol}' at position {index} is not in the alphabet.")
        following = dfa["transitions"][state][symbol]
        steps.append({"index": index, "symbol": symbol, "from_state": state, "to_state": following, "note": f"δ({state}, {symbol}) = {following}"})
        state = following
    accepted = state in dfa["accepting_states"]
    return {"input": value, "accepted": accepted, "final_state": state, "steps": steps}


class DfaValidationError(RegexError):
    """The student-supplied transition system is not a complete DFA."""


def validate_dfa(dfa: dict, alphabet: list[str] | None = None) -> dict:
    """Validate and return a normalized, complete, deterministic DFA.

    Each (state, symbol) cell must contain exactly one string destination.
    Array destinations are rejected as conflicting transitions.
    """
    if not isinstance(dfa, dict):
        raise DfaValidationError("Provide the DFA as a JSON object.")
    states = dfa.get("states")
    symbols = alphabet if alphabet is not None else dfa.get("alphabet")
    transitions = dfa.get("transitions")
    start = dfa.get("start_state")
    accepting = dfa.get("accepting_states")
    if not isinstance(states, list) or not states:
        raise DfaValidationError("Add at least one state.")
    if any(not isinstance(s, str) or not s.strip() for s in states):
        raise DfaValidationError("State names must be non-empty strings.")
    states = [s.strip() for s in states]
    if len(states) != len(set(states)):
        raise DfaValidationError("State names must be unique.")
    if not isinstance(symbols, list) or not symbols:
        raise DfaValidationError("Specify a non-empty input alphabet.")
    symbols = [str(s).strip() for s in symbols]
    if any(len(s) != 1 for s in symbols):
        raise DfaValidationError("Only single-character alphabet symbols are supported.")
    if len(symbols) != len(set(symbols)):
        raise DfaValidationError("Alphabet symbols must be unique.")
    reserved_symbols = set("()|*+?") | {chr(0x03B5), chr(0x2205)}
    if any(symbol in reserved_symbols for symbol in symbols):
        raise DfaValidationError("Regex operators, epsilon, and the empty-language marker cannot be alphabet symbols.")
    if alphabet is not None and dfa.get("alphabet") != symbols:
        raise DfaValidationError("The DFA alphabet must match the specified question alphabet.")
    if not isinstance(start, str) or start not in states:
        raise DfaValidationError("Select exactly one valid initial state.")
    if not isinstance(accepting, list) or any(s not in states for s in accepting):
        raise DfaValidationError("Every accepting state must exist in the state set.")
    if len(accepting) != len(set(accepting)):
        raise DfaValidationError("Accepting states must not be duplicated.")
    if not isinstance(transitions, dict) or set(transitions) != set(states):
        raise DfaValidationError("Transition rows must exist for exactly the declared states.")
    normalized = {}
    for state in states:
        row = transitions[state]
        if not isinstance(row, dict):
            raise DfaValidationError(f"Transition row for {state} must be an object.")
        extra = set(row) - set(symbols)
        if extra:
            raise DfaValidationError(f"Unexpected transition symbol(s) for {state}: {', '.join(map(str, sorted(extra)))}. Epsilon transitions are not allowed.")
        missing = set(symbols) - set(row)
        if missing:
            raise DfaValidationError(f"Missing transition(s) from {state} for: {', '.join(sorted(missing))}.")
        normalized[state] = {}
        for symbol in symbols:
            destination = row[symbol]
            if isinstance(destination, (list, tuple, set)):
                raise DfaValidationError(f"Conflicting transitions from {state} on {symbol}; a DFA has exactly one destination per symbol.")
            if not isinstance(destination, str) or destination not in states:
                raise DfaValidationError(f"Transition from {state} on {symbol} must lead to a declared state.")
            normalized[state][symbol] = destination
    return {**dfa, "states": states, "alphabet": symbols, "transitions": normalized,
            "start_state": start, "accepting_states": list(accepting), "complete": True}


def reachable_states(dfa: dict) -> set[str]:
    """Return the states reachable from the start state of a complete DFA."""
    machine = validate_dfa(dfa)
    reached = {machine["start_state"]}
    pending = [machine["start_state"]]
    while pending:
        state = pending.pop()
        for symbol in machine["alphabet"]:
            target = machine["transitions"][state][symbol]
            if target not in reached:
                reached.add(target)
                pending.append(target)
    return reached


def is_language_empty(dfa: dict) -> bool:
    """Decide emptiness by checking whether any accepting state is reachable."""
    machine = validate_dfa(dfa)
    return not (reachable_states(machine) & set(machine["accepting_states"]))


def complement_dfa(dfa: dict) -> dict:
    """Complement a complete DFA over its declared alphabet."""
    machine = validate_dfa(dfa)
    return {
        **machine,
        "accepting_states": [state for state in machine["states"] if state not in set(machine["accepting_states"])],
        "minimized": False,
    }


def product_dfa(left: dict, right: dict, operation: str = "intersection") -> dict:
    """Build the reachable product DFA for a standard Boolean language operation."""
    predicates = {
        "union": lambda a, b: a or b,
        "intersection": lambda a, b: a and b,
        "difference": lambda a, b: a and not b,
        "symmetric_difference": lambda a, b: a != b,
    }
    if operation not in predicates:
        raise DfaValidationError(f"Unsupported DFA product operation: {operation}.")
    left = validate_dfa(left)
    right = validate_dfa(right)
    if left["alphabet"] != right["alphabet"]:
        raise DfaValidationError("Product DFAs must use the same ordered alphabet.")
    alphabet = left["alphabet"]
    start = (left["start_state"], right["start_state"])
    pairs = [start]
    index = {start: 0}
    transitions: dict[str, dict[str, str]] = {}
    accepting: list[str] = []
    cursor = 0
    while cursor < len(pairs):
        pair = pairs[cursor]
        source = f"p{cursor}"
        left_accepts = pair[0] in left["accepting_states"]
        right_accepts = pair[1] in right["accepting_states"]
        if predicates[operation](left_accepts, right_accepts):
            accepting.append(source)
        row: dict[str, str] = {}
        for symbol in alphabet:
            following = (left["transitions"][pair[0]][symbol], right["transitions"][pair[1]][symbol])
            if following not in index:
                index[following] = len(pairs)
                pairs.append(following)
            row[symbol] = f"p{index[following]}"
        transitions[source] = row
        cursor += 1
    states = [f"p{i}" for i in range(len(pairs))]
    return {
        "states": states,
        "alphabet": alphabet,
        "transitions": transitions,
        "start_state": "p0",
        "accepting_states": accepting,
        "expression": "",
        "complete": True,
        "product_operation": operation,
    }


def union_dfa(left: dict, right: dict) -> dict:
    return product_dfa(left, right, "union")


def intersection_dfa(left: dict, right: dict) -> dict:
    return product_dfa(left, right, "intersection")


def difference_dfa(left: dict, right: dict) -> dict:
    return product_dfa(left, right, "difference")


def symmetric_difference_dfa(left: dict, right: dict) -> dict:
    return product_dfa(left, right, "symmetric_difference")


def shortest_counterexample(student: dict, reference: dict) -> str | None:
    """Return the shortest distinguishing string, breaking ties by alphabet order."""
    student = validate_dfa(student)
    reference = validate_dfa(reference)
    if student["alphabet"] != reference["alphabet"]:
        raise DfaValidationError("The student and reference DFAs must use the same ordered alphabet.")
    alphabet = student["alphabet"]
    start = (student["start_state"], reference["start_state"])
    queue = [start]
    parent: dict[tuple[str, str], tuple[tuple[str, str], str] | None] = {start: None}
    cursor = 0
    while cursor < len(queue):
        pair = queue[cursor]
        cursor += 1
        if (pair[0] in student["accepting_states"]) != (pair[1] in reference["accepting_states"]):
            chars = []
            current = pair
            while parent[current] is not None:
                previous, symbol = parent[current]
                chars.append(symbol)
                current = previous
            return "".join(reversed(chars))
        for symbol in alphabet:
            following = (student["transitions"][pair[0]][symbol], reference["transitions"][pair[1]][symbol])
            if following not in parent:
                parent[following] = (pair, symbol)
                queue.append(following)
    return None
