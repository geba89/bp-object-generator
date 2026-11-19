using System;
using System.Data;
using System.IO;
// Runs the code stage body exactly as Blue Prism would: inputs and output as variables
class Harness {
  static void Stage(string Text, bool Headers, out DataTable Table) {
    Table = null;
#line 1 "TextToCollection.cs"
    BODY
  }
  static void Main(string[] args) {
    foreach (string f in args) {
      foreach (bool headers in new[] { true, false }) {
        DataTable t;
        Stage(File.ReadAllText(f), headers, out t);
        Console.WriteLine("== " + Path.GetFileName(f) + " (Headers=" + headers + "): " + t.Rows.Count + " rows");
        var names = new System.Collections.Generic.List<string>();
        foreach (DataColumn c in t.Columns) names.Add(c.ColumnName);
        Console.WriteLine("   columns: " + string.Join(" | ", names.ToArray()));
        foreach (DataRow r in t.Rows) {
          var cells = new System.Collections.Generic.List<string>();
          foreach (object o in r.ItemArray) cells.Add((o == DBNull.Value ? "<null>" : o.ToString()).Replace("\n", "\\n"));
          Console.WriteLine("   " + string.Join(" | ", cells.ToArray()));
        }
      }
    }
    DataTable e; Stage("", true, out e); Console.WriteLine("== empty text: " + e.Rows.Count + " rows, " + e.Columns.Count + " columns");
  }
}
