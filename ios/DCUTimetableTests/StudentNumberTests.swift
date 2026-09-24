import Testing
@testable import DCUTimetable

/// Numbers here are made up. Real ones belong to real students and stay out of the repo.
@Suite("Student number")
struct StudentNumberTests {

    @Test("The barcode drops its leading 10 and trailing three digits and gains an A")
    func barcode() {
        #expect(StudentNumber(barcode: "1012345678001")?.value == "A12345678")
        #expect(StudentNumber(barcode: " 1000000042001\n")?.value == "A00000042")
    }

    @Test("A replacement card's suffix doesn't change the number")
    func replacementCard() {
        #expect(StudentNumber(barcode: "1012345678002") == StudentNumber(barcode: "1012345678001"))
    }

    /// The barcode has no check character, so its shape is the only defence against a
    /// misread or some other barcode being saved as a student number for good.
    @Test("Anything that isn't a student card's barcode is refused",
          arguments: ["2012345678001", "101234567800", "10123456780012", "10123456780O1",
                      "A12345678", "", "*1012345678001*"])
    func refusesOtherBarcodes(code: String) {
        #expect(StudentNumber(barcode: code) == nil)
    }

    @Test("Typing forgives case, spaces, hyphens and a missing A")
    func typed() {
        #expect(StudentNumber(typed: "A12345678")?.value == "A12345678")
        #expect(StudentNumber(typed: "a12345678")?.value == "A12345678")
        #expect(StudentNumber(typed: " A1234 5678 ")?.value == "A12345678")
        #expect(StudentNumber(typed: "A1234-5678")?.value == "A12345678")
        #expect(StudentNumber(typed: "12345678")?.value == "A12345678")
    }

    @Test("The number under the barcode can be typed instead")
    func typedBarcodeNumber() {
        #expect(StudentNumber(typed: "1012345678001")?.value == "A12345678")
    }

    /// The server accepts any letter (`^[A-Z][0-9]{8}$`), so the app does too rather than
    /// turn away a number the database would take.
    @Test("Another leading letter is kept, not replaced")
    func otherLetter() {
        #expect(StudentNumber(typed: "b12345678")?.value == "B12345678")
    }

    @Test("A wrong length or stray character is refused",
          arguments: ["A1234567", "A123456789", "AB12345678", "A1234567X", "1234567", "", "Ａ12345678"])
    func refusesTypos(entry: String) {
        #expect(StudentNumber(typed: entry) == nil)
    }
}
