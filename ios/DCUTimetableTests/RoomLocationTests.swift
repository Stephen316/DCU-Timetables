import Foundation
import Testing
@testable import DCUTimetable

struct RoomLocationTests {

    @Test func decodesBuildingFloorAndRoom() {
        // The worked example: FT301 → Polaris, floor 3, room 301.
        let loc = RoomLocation("GLA.FT301")
        #expect(loc.campus == .glasnevin)
        #expect(loc.code == "FT301")           // campus prefix dropped
        #expect(loc.buildingCode == "FT")
        #expect(loc.buildingName == "Polaris")
        #expect(loc.floor == .numbered(3))
        #expect(loc.room == "301")
        #expect(loc.displayText == "Polaris, Room 301, Floor 3")
    }

    @Test func decodesGroundBasementAndExtension() {
        let ground = RoomLocation("GLA.CG86")          // Henry Grattan, ground, 86
        #expect(ground.buildingName == "Henry Grattan")
        #expect(ground.floor == .ground)
        #expect(ground.room == "86")

        let stokesGround = RoomLocation("GLA.SG23")
        #expect(stokesGround.buildingName == "Stokes")
        #expect(stokesGround.floor == .ground)

        let basement = RoomLocation("GLA.SB39")
        #expect(basement.buildingName == "Stokes")
        #expect(basement.floor == .basement)

        // SA is its own building code (Stokes Extension), not S + floor A.
        let extensionRoom = RoomLocation("GLA.SA101")
        #expect(extensionRoom.buildingCode == "SA")
        #expect(extensionRoom.buildingName == "Stokes Extension")
        #expect(extensionRoom.floor == .numbered(1))
    }

    @Test func decodesOtherGlasnevinBuildings() {
        #expect(RoomLocation("GLA.T101").buildingName == "Terence Larkin Theatre")
        #expect(RoomLocation("GLA.XG28").buildingName == "Lonsdale")
        #expect(RoomLocation("GLA.HG22").buildingName == "Nursing Building")
        #expect(RoomLocation("GLA.QG15").buildingName == "DCU Business School")
        #expect(RoomLocation("GLA.LG25").buildingName == "McNulty")
    }

    @Test func handlesCompoundRoomStrings() {
        let loc = RoomLocation("GLA.XG28 & XG28-A")
        #expect(loc.code == "XG28 & XG28-A")   // shown in full, campus stripped
        #expect(loc.buildingName == "Lonsdale")
        #expect(loc.floor == .ground)
    }

    @Test func doesNotInventNamesForOtherCampuses() {
        let allHallows = RoomLocation("AHC.CG01")
        #expect(allHallows.campus == .allHallows)
        #expect(allHallows.code == "CG01")
        #expect(allHallows.buildingName == nil)      // no Glasnevin map for AHC
        #expect(allHallows.displayText == "CG01")

        let stPats = RoomLocation("SPC.B101")
        #expect(stPats.campus == .stPatricks)
        #expect(stPats.buildingName == nil)
    }

    @Test func eventLocationDisplayCollapsesMultipleRooms() {
        func event(_ rooms: [String]) -> TimetableEvent {
            TimetableEvent(id: "x", start: Date(), end: Date(), type: .onCampus,
                           locations: rooms, moduleName: nil, staff: [],
                           activity: ActivityCode(""), weekLabels: [])
        }
        #expect(event([]).locationDisplay == "—")
        #expect(event(["GLA.FT301"]).locationDisplay == "Polaris, Room 301, Floor 3")
        // several rooms → name + room each, so the row stays readable
        #expect(event(["GLA.T101", "GLA.HG22"]).locationDisplay
                == "Terence Larkin Theatre, Room 101 · Nursing Building, Room 22")
    }
}
