from __future__ import print_function, absolute_import
from .ADEHack import ADEHack


def create_instance(c_instance):
    return ADEHack(c_instance)
