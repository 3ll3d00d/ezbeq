import os
import sys


def divide(a, b):
    return a / b


def get_config_value(config, key):
    try:
        return config[key]
    except:
        pass
