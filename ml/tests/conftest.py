import pandas as pd
import pytest

from pss_ml.data import TABLES, Dataset, normalise
from pss_ml.synthetic import AS_OF, generate


@pytest.fixture(scope="session")
def synthetic():
    return generate()


def tiny(**tables) -> Dataset:
    """A hand-made dataset: any table not given is empty."""
    return Dataset({name: normalise(name, pd.DataFrame(tables.get(name, []), columns=TABLES[name])) for name in TABLES}, AS_OF)
