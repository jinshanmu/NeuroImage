"""Explicit numerical precision for unchanged source probability samples."""
import math


def rounding_tolerance(recipe):
    tolerance = recipe.get("probability_rounding_tolerance", 0)
    if (type(tolerance) not in (int, float) or not math.isfinite(tolerance)
            or not 0 <= tolerance <= 1e-6):
        raise ValueError("Source probability rounding tolerance must be between zero and 1e-6")
    if tolerance and (not isinstance(recipe.get("probability_rounding_evidence"), str)
                      or not recipe["probability_rounding_evidence"].strip()):
        raise ValueError("Source probability rounding tolerance requires explicit precision evidence")
    return tolerance
