import Foundation

/// The public pages App Review and the App Store listing point at, served by GitHub Pages
/// from `site/` in this repository. Change them here and in App Store Connect together.
enum AppLinks {
    private static let base = "https://stephen316.github.io/DCU-Timetables"

    static let privacy = URL(string: "\(base)/privacy.html")!
    static let terms = URL(string: "\(base)/terms.html")!
    static let support = URL(string: "\(base)/support.html")!
}
