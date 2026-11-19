// Turns the text of a table into a collection.
// Chrome gives a table's text with one row per line and the cells separated by tabs.
// Inputs: Text (text), Headers (flag: first row = column names). Output: Table (collection).
Table = new DataTable();
string[] lines = (Text ?? "").Replace("\r", "").Split('\n');
var rows = new System.Collections.Generic.List<string>();
foreach (string line in lines)
	if (line.Trim() != "") rows.Add(line);
if (rows.Count == 0) return;

// The widest row decides how many columns the table has. Short lines BEFORE the first
// full row are a caption or title above the table: they are skipped.
Func<string, int> tabs = (s) => s.Split('\t').Length - 1;
int width = 0;
foreach (string row in rows) width = Math.Max(width, tabs(row) + 1);
while (rows.Count > 1 && tabs(rows[0]) < width - 1) rows.RemoveAt(0);

// A cell with a line break splits its row in two short lines ("x<TAB>y1" + "y2<TAB>z"):
// join two short lines when together they make exactly one row
var joined = new System.Collections.Generic.List<string>();
for (int i = 0; i < rows.Count; i++)
{
	string row = rows[i];
	while (i > 0 && tabs(row) < width - 1 && i + 1 < rows.Count
		&& tabs(rows[i + 1]) < width - 1 && tabs(row) + tabs(rows[i + 1]) <= width - 1)
	{
		row = row + "\n" + rows[i + 1];
		i++;
	}
	joined.Add(row);
}

for (int i = 0; i < joined.Count; i++)
{
	string[] cells = joined[i].Split('\t');
	if (i == 0)
	{
		// Column names: the header texts, or "Column 1", "Column 2"...; duplicates get " 2"
		for (int c = 0; c < width; c++)
		{
			string name = (Headers && c < cells.Length) ? cells[c].Trim() : "";
			if (name == "") name = "Column " + (c + 1);
			string unique = name;
			for (int n = 2; Table.Columns.Contains(unique); n++) unique = name + " " + n;
			Table.Columns.Add(unique, typeof(string));
		}
		if (Headers) continue;
	}
	// A row with more cells than the header (rare) keeps the extra text in the last column
	DataRow r = Table.NewRow();
	for (int c = 0; c < width; c++) r[c] = ""; // missing cells are empty text, not null
	for (int c = 0; c < cells.Length; c++)
	{
		int col = Math.Min(c, width - 1);
		string v = cells[c].Trim();
		r[col] = (c >= width && r[col].ToString() != "") ? r[col] + " " + v : v;
	}
	Table.Rows.Add(r);
}
