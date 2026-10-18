"""Compact scene provenance with a reference to the exact package recipe."""


def processing_record(build):
    """Retain construction identity, inputs, parameters and software versions."""
    record = dict(build)
    if "recipe" in record:
        del record["recipe"]
        record["recipe_reference"] = "manifest.json#/build/recipe"
    return record
