"""Project only confirmed fields into the existing nullable videos columns.

Unknown and retained historical attributions produce no advertising UPDATE fields.
Keep parity with web/lib/sponsorship-state.ts; no provider or database I/O here.
"""


def confirmed_sponsorship_fields(value):
    ads = value if isinstance(value, dict) else {}
    names = ads.get("what_ads")
    if isinstance(names, str):
        names = [names] if names.strip() else []
    elif isinstance(names, list) and all(isinstance(name, str) for name in names):
        names = [name for name in names if name.strip()]
    elif names is None:
        names = []
    else:
        return {}
    analysis = ads.get("sponsor_analysis")
    if "sponsor_analysis" in ads:
        if not isinstance(analysis, dict) or analysis.get("status") != "completed" or analysis.get("retained_previous"):
            return {}
        if "retained_previous" in analysis and type(analysis["retained_previous"]) is not bool:
            return {}
        if analysis.get("outcome") not in ("detected", "confirmed_none"):
            return {}
    if ads.get("is_ads") is False and not names and (analysis is None or analysis.get("outcome") == "confirmed_none"):
        return {"is_ads": False, "advertisers": []}
    if ads.get("is_ads") is True and (analysis is None or (analysis.get("outcome") == "detected" and names)):
        return {"is_ads": True, **({"advertisers": names} if names else {})}
    return {}
