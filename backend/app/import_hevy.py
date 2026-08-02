"""Import a Hevy CSV export from the command line (handy for cron / one-off loads):

    cd backend
    python -m app.import_hevy /path/to/hevy_export.csv

With no argument, imports every *.csv in the configured import dir and archives them.
"""
import sys
from .db import init_db
from .services import sync


def main():
    init_db()
    if len(sys.argv) > 1:
        for path in sys.argv[1:]:
            res = sync.import_csv_file(path)
            print(res)
    else:
        res = sync.import_csv_folder()
        print(res)


if __name__ == "__main__":
    main()
