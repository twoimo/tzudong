"""Unambiguous UTF-8 JSON for content-addressed admission receipts."""
import json
import math


def parse_receipt_json(raw: bytes):
    def object_pairs(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError('ambiguous_receipt_json')
            result[key] = value
        return result

    def invalid_constant(_value):
        raise ValueError('invalid_receipt_number')

    def finite_float(value):
        result = float(value)
        if not math.isfinite(result):
            raise ValueError('invalid_receipt_number')
        return result

    return json.loads(raw.decode('utf-8'), object_pairs_hook=object_pairs,
                      parse_constant=invalid_constant, parse_float=finite_float)
