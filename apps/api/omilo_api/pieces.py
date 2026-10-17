"""Connector pieces: manifest schema and validation."""
import re

# Slug pattern: start with lowercase alphanumeric, allow hyphens, max 41 chars total
SLUG = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")


def validate_manifest(data: dict) -> list[str]:
    """Validate a connector piece manifest.

    Args:
        data: A manifest dictionary to validate.

    Returns:
        A list of error messages (empty list = valid manifest).
    """
    errors = []

    # Top-level required fields
    if not isinstance(data, dict):
        errors.append("Manifest must be a dictionary.")
        return errors

    # Validate 'id'
    id_val = data.get("id")
    if not id_val or not isinstance(id_val, str):
        errors.append("Missing or invalid 'id': must be a non-empty string.")
    elif not SLUG.match(id_val):
        errors.append(
            f"Invalid 'id' '{id_val}': must start with lowercase alphanumeric, "
            "allow hyphens, max 41 characters."
        )

    # Validate 'label'
    label = data.get("label")
    if not label or not isinstance(label, str):
        errors.append("Missing or invalid 'label': must be a non-empty string.")

    # Validate 'category'
    category = data.get("category")
    if not category or not isinstance(category, str):
        errors.append("Missing or invalid 'category': must be a non-empty string.")

    # Validate 'description'
    description = data.get("description")
    if not description or not isinstance(description, str):
        errors.append("Missing or invalid 'description': must be a non-empty string.")

    # Validate 'auth'
    auth = data.get("auth")
    if not isinstance(auth, dict):
        errors.append("Missing or invalid 'auth': must be a dictionary.")
    else:
        # Validate auth.type
        auth_type = auth.get("type")
        if auth_type != "oauth2":
            errors.append(
                f"Invalid 'auth.type' '{auth_type}': must be 'oauth2'."
            )

        # Validate auth.provider
        provider = auth.get("provider")
        if not provider or not isinstance(provider, str):
            errors.append(
                "Missing or invalid 'auth.provider': must be a non-empty string."
            )

        # Validate auth.scopes
        scopes = auth.get("scopes")
        if not isinstance(scopes, list) or len(scopes) == 0:
            errors.append(
                "Missing or invalid 'auth.scopes': must be a non-empty list."
            )

    # Validate 'actions'
    actions = data.get("actions")
    if not isinstance(actions, list) or len(actions) == 0:
        errors.append("Missing or invalid 'actions': must be a non-empty list.")
    else:
        for i, action in enumerate(actions):
            if not isinstance(action, dict):
                errors.append(f"Action {i}: must be a dictionary.")
                continue

            # Validate action.name
            name = action.get("name")
            if not name or not isinstance(name, str):
                errors.append(f"Action {i}: missing or invalid 'name'.")
            elif not SLUG.match(name):
                errors.append(
                    f"Action {i}: invalid 'name' '{name}': must match slug pattern."
                )

            # Validate action.label
            action_label = action.get("label")
            if not action_label or not isinstance(action_label, str):
                errors.append(f"Action {i}: missing or invalid 'label'.")

            # Validate action.approval
            approval = action.get("approval")
            if approval not in ("auto", "ask"):
                errors.append(
                    f"Action {i}: invalid 'approval' '{approval}': must be 'auto' or 'ask'."
                )

            # Validate action.http
            http = action.get("http")
            if not isinstance(http, dict):
                errors.append(f"Action {i}: missing or invalid 'http'.")
            else:
                # Validate http.method
                method = http.get("method")
                valid_methods = {"GET", "POST", "PUT", "PATCH", "DELETE"}
                if method not in valid_methods:
                    errors.append(
                        f"Action {i}: invalid 'http.method' '{method}': "
                        f"must be one of {valid_methods}."
                    )

                # Validate http.url
                url = http.get("url")
                if not url or not isinstance(url, str):
                    errors.append(f"Action {i}: missing or invalid 'http.url'.")
                elif not url.startswith("https://"):
                    errors.append(
                        f"Action {i}: invalid 'http.url' '{url}': must be absolute HTTPS."
                    )

                # Validate http.auth
                auth_type = http.get("auth")
                if auth_type != "bearer":
                    errors.append(
                        f"Action {i}: invalid 'http.auth' '{auth_type}': must be 'bearer'."
                    )

            # Validate action.inputs (optional but if present, must be well-formed)
            inputs = action.get("inputs")
            if inputs is not None:
                if not isinstance(inputs, list):
                    errors.append(f"Action {i}: 'inputs' must be a list.")
                else:
                    for j, inp in enumerate(inputs):
                        if not isinstance(inp, dict):
                            errors.append(f"Action {i}, input {j}: must be a dictionary.")
                            continue

                        # Validate input.name
                        inp_name = inp.get("name")
                        if not inp_name or not isinstance(inp_name, str):
                            errors.append(
                                f"Action {i}, input {j}: missing or invalid 'name'."
                            )

                        # Validate input.type
                        inp_type = inp.get("type")
                        if not inp_type or not isinstance(inp_type, str):
                            errors.append(
                                f"Action {i}, input {j}: missing or invalid 'type'."
                            )

    return errors
