import SafariServices
import SwiftUI

/// A web page shown over the app rather than in Safari, so reading the privacy policy
/// doesn't leave the app.
struct SafariSheet: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

/// `sheet(item:)` needs something Identifiable.
struct WebPage: Identifiable {
    let url: URL
    var id: URL { url }
}
