import Foundation
import Testing
@testable import DCUTimetable

struct EventMapperTests {

    /// Mirrors the real `Public/.../Events/Filter` response shape (see docs/API.md).
    private let fixture = """
    {"CategoryEvents":[{"Identity":"cat","Name":"AC1","Results":[
      {"Identity":"e1","StartDateTime":"2026-09-15T13:30:00+00:00","EndDateTime":"2026-09-15T15:00:00+00:00",
       "EventType":"On Campus","Location":"GLA.T101, GLA.HG22","Name":"BIO1000[1]OC/L1/01 Surname A - M",
       "ExtraProperties":[{"Name":"Module Name","Value":"BIO1000[1] How life works 1"},
                          {"Name":"Staff Member","Value":"Tejada, A"}],"WeekLabels":"2"},
      {"Identity":"e2","StartDateTime":"2026-09-15T18:00:00+00:00","EndDateTime":"2026-09-15T20:00:00+00:00",
       "EventType":"Asynchronous (Recorded)","Location":null,"Name":"MTH1033[1]AY/L1/01",
       "ExtraProperties":[{"Name":"Module Name","Value":"MTH1033 Calculus"}],"WeekLabels":"2"}
    ]}],"BookingRequests":null,"PersonalEvents":null}
    """

    @Test func mapsEventsFromResponse() throws {
        let dto = try JSONDecoder().decode(EventsResponseDTO.self, from: Data(fixture.utf8))
        let events = EventMapper.events(from: dto)
        #expect(events.count == 2)

        let first = events[0]
        #expect(first.moduleName == "BIO1000[1] How life works 1")
        #expect(first.moduleCode == "BIO1000")
        #expect(first.locations == ["GLA.T101", "GLA.HG22"])
        #expect(first.type == .onCampus)
        #expect(first.staff == ["Tejada, A"])
        #expect(first.activity.kind == .lecture)
        #expect(first.weekLabels == ["2"])

        let second = events[1]
        #expect(second.type == .asynchronous)
        #expect(second.locations.isEmpty)
        #expect(second.staff.isEmpty)
    }

    @Test func parsesMultiRoomAndEmptyLocations() {
        #expect(EventMapper.locations(from: "GLA.T101, GLA.HG22") == ["GLA.T101", "GLA.HG22"])
        #expect(EventMapper.locations(from: nil).isEmpty)
        #expect(EventMapper.locations(from: "").isEmpty)
    }

    @Test func parsesISO8601DatesWithOffset() {
        let date = APIDate.date(from: "2026-09-15T13:30:00+00:00")
        #expect(date != nil)
    }
}
