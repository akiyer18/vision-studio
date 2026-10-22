"""Check a tool payload against the JSON schema sent with the tool."""

from __future__ import annotations


def matches_schema(schema: dict, value: object) -> bool:
    if not isinstance(schema, dict):
        return False
    expected = schema.get("type")
    if expected == "object":
        if not isinstance(value, dict):
            return False
        properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        if schema.get("additionalProperties") is False and any(key not in properties for key in value):
            return False
        required = schema.get("required") if isinstance(schema.get("required"), list) else []
        if any(key not in value for key in required):
            return False
        for key, item in value.items():
            child = properties.get(key)
            if isinstance(child, dict) and not matches_schema(child, item):
                return False
        return True
    if expected == "array":
        if not isinstance(value, list):
            return False
        items = schema.get("items")
        if isinstance(items, dict):
            return all(matches_schema(items, item) for item in value)
        return True
    if expected == "string":
        if not isinstance(value, str):
            return False
    elif expected == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return False
        minimum = schema.get("minimum")
        maximum = schema.get("maximum")
        if isinstance(minimum, (int, float)) and value < minimum:
            return False
        if isinstance(maximum, (int, float)) and value > maximum:
            return False
    elif expected == "integer":
        if isinstance(value, bool) or not isinstance(value, int):
            return False
    elif expected == "boolean" and not isinstance(value, bool):
        return False
    enum = schema.get("enum")
    if isinstance(enum, list) and value not in enum:
        return False
    return True
