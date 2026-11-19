"""Copy bp-xpath-scanner.js into bp-object-generator.html (between the SCANNER markers),
so the generator's "Copy scanner" button always hands out the current scanner."""
import datetime, pathlib, re, sys

root = pathlib.Path(__file__).parent
scanner = (root / 'bp-xpath-scanner.js').read_text(encoding='utf-8')
gen_path = root / 'bp-object-generator.html'
gen = gen_path.read_text(encoding='utf-8')

# Inside <script type="text/plain"> the browser keeps text as-is until "</script"
if re.search(r'</script', scanner, re.I):
    sys.exit('The scanner contains "</script" and cannot be embedded as it is.')

block = (f'<script type="text/plain" id="scannerSource" data-updated="{datetime.date.today().isoformat()}">\n'
         f'{scanner.rstrip()}\n</script>')
pattern = re.compile(r'(<!-- SCANNER:BEGIN[^>]*-->\n).*?(\n<!-- SCANNER:END -->)', re.S)
if not pattern.search(gen):
    sys.exit('SCANNER markers not found in the generator.')
gen = pattern.sub(lambda m: m.group(1) + block + m.group(2), gen, count=1)
gen_path.write_text(gen, encoding='utf-8')
print(f'Embedded the scanner ({len(scanner.splitlines())} lines) into {gen_path.name}')
