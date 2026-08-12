#!/usr/bin/env python3
"""Generate the filled sample workbooks in samples/ from the blank templates.

The templates in templates/ stay empty — they are what the UI hands users to
fill in. These samples are dummy data for exercising the app end to end:
two 15-hour class blocks, 95 students, seven coaches.

Each sample is the matching template with its sheet rows replaced, so the
column headers, widths, styles and sheet name are identical to what a user
would be working from.
"""

import shutil
import zipfile
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATES = ROOT / 'templates'
SAMPLES = ROOT / 'samples'

# --- the data ---------------------------------------------------------------

# Two cohorts, each totalling exactly 15 hours across the block (parse.js
# checkClassBlockTotals), every class window between 1.5 and 3 hours.
# Block A runs mornings, Block B afternoons, so coach windows blocked for one
# cohort stay usable by the other.
CLASSES = [
    ('Block A', 'Monday', '09:00', '12:00', 'Marketing Fundamentals'),      # 3.0
    ('Block A', 'Tuesday', '09:00', '11:30', 'Customer Research'),          # 2.5
    ('Block A', 'Wednesday', '09:00', '12:00', 'Brand Strategy'),           # 3.0
    ('Block A', 'Thursday', '09:00', '10:30', 'Analytics Lab'),             # 1.5
    ('Block A', 'Thursday', '13:00', '15:00', 'Campaign Workshop'),         # 2.0
    ('Block A', 'Friday', '09:00', '12:00', 'Capstone Studio'),             # 3.0
    ('Block B', 'Monday', '13:00', '16:00', 'Product Foundations'),         # 3.0
    ('Block B', 'Tuesday', '13:00', '15:00', 'User Interviews'),            # 2.0
    ('Block B', 'Tuesday', '16:00', '18:30', 'Roadmapping'),                # 2.5
    ('Block B', 'Wednesday', '13:00', '16:00', 'Discovery Sprint'),         # 3.0
    ('Block B', 'Thursday', '13:00', '14:30', 'Metrics Clinic'),            # 1.5
    ('Block B', 'Friday', '13:00', '16:00', 'Capstone Studio'),             # 3.0
]

# One-hour windows spaced an hour apart (09:00–10:00, 11:00–12:00, ...).
# Five coaches with 16 windows, one with 9, one with 6.
COACH_PLAN = [
    ('Priya Raman', '005XX000001', ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], [9, 11, 13, 15]),
    ('Daniel Okafor', '005XX000002', ['Monday', 'Tuesday', 'Wednesday', 'Thursday'], [10, 12, 14, 16]),
    ('Sofia Marchetti', '005XX000003', ['Tuesday', 'Wednesday', 'Thursday', 'Friday'], [11, 13, 15, 17]),
    ('James Whitfield', '005XX000004', ['Monday', 'Wednesday', 'Thursday', 'Friday'], [9, 11, 13, 15]),
    ('Amara Nwosu', '005XX000005', ['Monday', 'Tuesday', 'Thursday', 'Friday'], [10, 12, 14, 16]),
    ('Tomas Lindqvist', '005XX000006', ['Monday', 'Wednesday', 'Friday'], [9, 11, 13]),
    ('Hannah Berger', '005XX000007', ['Tuesday', 'Thursday'], [13, 15, 17]),
]

FIRST_NAMES = [
    'Aisha', 'Ben', 'Chloe', 'Dmitri', 'Elena', 'Farid', 'Grace', 'Hugo', 'Isla', 'Jonas',
    'Kiara', 'Liam', 'Mina', 'Noah', 'Olive', 'Pablo', 'Quinn', 'Rosa', 'Samir', 'Tara',
    'Umar', 'Vera', 'Wesley', 'Xenia', 'Yusuf', 'Zara', 'Arjun', 'Bianca', 'Cormac', 'Delphine',
    'Eitan', 'Freya', 'Gustavo', 'Hana', 'Ivan', 'Jelena', 'Kofi', 'Lucia', 'Mateo', 'Nadia',
    'Oscar', 'Petra', 'Rafael', 'Saoirse', 'Theo', 'Ulla', 'Viktor', 'Wren',
]
LAST_NAMES = [
    'Ahmed', 'Barnes', 'Chen', 'Duarte', 'Egan', 'Fischer', 'Gallagher', 'Haddad', 'Ibrahim',
    'Jansen', 'Kowalski', 'Lombardi', 'Mbeki', 'Nakamura', 'Ortega', 'Pearson', 'Quintero',
    'Rossi', 'Silva', 'Thompson', 'Ueda', 'Vargas', 'Walsh', 'Yildiz',
]

STUDENT_COUNT = 95
SF_ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'


def student_rows():
    rows = []
    used_emails = {}
    for i in range(STUDENT_COUNT):
        first = FIRST_NAMES[i % len(FIRST_NAMES)]
        last = LAST_NAMES[(i * 7 + i // len(LAST_NAMES)) % len(LAST_NAMES)]
        name = f'{first} {last}'
        local = f'{first}.{last}'.lower()
        # Emails must be unique in practice even though the parser only
        # enforces unique Contact SF IDs.
        seen = used_emails.get(local, 0)
        used_emails[local] = seen + 1
        email = f'{local}@example.com' if seen == 0 else f'{local}{seen + 1}@example.com'
        # A student belongs to exactly one class block; alternating keeps the
        # two cohorts close to even (48 / 47).
        block = 'Block A' if i % 2 == 0 else 'Block B'
        rows.append((sf_id(i), name, email, block))
    return rows


def sf_id(index):
    """A unique, Salesforce-shaped 15-character Contact ID."""
    suffix = ''
    n = index
    for _ in range(5):
        suffix = SF_ID_ALPHABET[n % len(SF_ID_ALPHABET)] + suffix
        n //= len(SF_ID_ALPHABET)
    return '0031t00000' + suffix


def coach_rows():
    rows = []
    for name, coach_sf_id, days, starts in COACH_PLAN:
        email = name.lower().replace(' ', '.') + '@example.com'
        for day in days:
            for hour in starts:
                rows.append((name, coach_sf_id, email, day, f'{hour:02d}:00', f'{hour + 1:02d}:00'))
    return rows


# --- workbook writing -------------------------------------------------------

SHEET_PATH = 'xl/worksheets/sheet1.xml'


def cell(ref, value, style):
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'


def column_letter(index):
    letters = ''
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def sheet_xml(template_xml, header, legend, rows):
    """Rebuild sheet1.xml with the template's header and legend, plus `rows`.

    Only <dimension> and <sheetData> change; everything else (cols, views,
    margins) is carried over from the template verbatim.
    """
    body = [
        '<row r="1">' + ''.join(cell(f'{column_letter(i)}1', name, 1) for i, name in enumerate(header)) + '</row>',
        f'<row r="2">{cell("A2", legend, 2)}</row>',
    ]
    for offset, row in enumerate(rows):
        r = offset + 3
        cells = ''.join(cell(f'{column_letter(i)}{r}', value, 3) for i, value in enumerate(row))
        body.append(f'<row r="{r}">{cells}</row>')

    last_ref = f'{column_letter(len(header) - 1)}{len(rows) + 2}'
    head, _, tail = template_xml.partition('<sheetData>')
    _, _, tail = tail.partition('</sheetData>')
    head = replace_dimension(head, last_ref)
    return head + '<sheetData>' + ''.join(body) + '</sheetData>' + tail


def replace_dimension(head, last_ref):
    start = head.index('<dimension ref="')
    end = head.index('/>', start) + 2
    return head[:start] + f'<dimension ref="A1:{last_ref}"/>' + head[end:]


def legend_of(template_xml):
    """The template's own legend row, reused verbatim in the sample."""
    marker = '<c r="A2"'
    start = template_xml.index('<t>', template_xml.index(marker)) + 3
    end = template_xml.index('</t>', start)
    return unescape_xml(template_xml[start:end])


def unescape_xml(text):
    return (
        text.replace('&lt;', '<').replace('&gt;', '>').replace('&quot;', '"')
        .replace('&#39;', "'").replace('&amp;', '&')
    )


def header_of(template_xml):
    row = template_xml[template_xml.index('<row r="1">'):template_xml.index('</row>')]
    names = []
    cursor = 0
    while True:
        start = row.find('<t>', cursor)
        if start == -1:
            break
        end = row.index('</t>', start)
        names.append(unescape_xml(row[start + 3:end]))
        cursor = end
    return names


def write_sample(template_name, sample_name, rows):
    template_path = TEMPLATES / template_name
    sample_path = SAMPLES / sample_name
    shutil.copyfile(template_path, sample_path)

    with zipfile.ZipFile(template_path) as source:
        entries = [(item, source.read(item.filename)) for item in source.infolist()]
    template_xml = next(data for item, data in entries if item.filename == SHEET_PATH).decode('utf-8')

    new_xml = sheet_xml(template_xml, header_of(template_xml), legend_of(template_xml), rows).encode('utf-8')
    with zipfile.ZipFile(sample_path, 'w', zipfile.ZIP_DEFLATED) as out:
        for item, data in entries:
            out.writestr(item, new_xml if item.filename == SHEET_PATH else data)
    return sample_path


def main():
    SAMPLES.mkdir(exist_ok=True)
    written = [
        write_sample('class_schedule_template.xlsx', 'class_schedule_sample.xlsx', CLASSES),
        write_sample('students_template.xlsx', 'students_sample.xlsx', student_rows()),
        write_sample('coach_availability_template.xlsx', 'coach_availability_sample.xlsx', coach_rows()),
    ]
    for path in written:
        print(f'wrote {path.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
