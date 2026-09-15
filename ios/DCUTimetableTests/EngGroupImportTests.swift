import Foundation
import Testing
@testable import DCUTimetable

struct EngGroupImportTests {

    @Test func parsesMarkdownTable() {
        let md = """
        # EEG1001 Groups
        | Surname | First Name | Group | Sub-group | Day | Workshop | Drawing |
        |---------|-----------|-------|-----------|-----|----------|---------|
        | Anand | Amrit | B | B.1 | Tue | SG23 | SB39 |
        | Mc Bride | Rory | A | A.3 | Tue | SG25 | SB38 |
        """
        let index = EngGroupDirectory.parseTable(md)
        #expect(index["anand"]?.first?.group == "B")
        #expect(index["anand"]?.first?.subgroup == "B.1")
        #expect(index["anand"]?.first?.name == "Anand Amrit")
        // multi-word surname indexed by both the full surname and its first token
        #expect(index["mc bride"]?.first?.group == "A")
        #expect(index["mc"]?.first?.group == "A")
    }

    @Test func parsesCSVDerivingLetterFromSubgroup() {
        let csv = "Surname,First Name,Group,Day,Workshop,Drawing\nBarry,Ella,B.1,Tue,SG23,SB39"
        let index = EngGroupDirectory.parseTable(csv)
        #expect(index["barry"]?.first?.group == "B")     // letter derived from "B.1"
        #expect(index["barry"]?.first?.subgroup == "B.1")
    }

    @Test func ignoresTablesWithoutASurnameHeader() {
        #expect(EngGroupDirectory.parseTable("just some text\nno table here").isEmpty)
    }
}
