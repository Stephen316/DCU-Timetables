import SwiftUI

/// Search DCU programmes of study and pick one. (Group selection is the planned next
/// onboarding step — see docs/PLAN.md.)
struct ProgrammePickerView: View {
    let onSelect: (TimetableCategory) -> Void

    @State private var query = ""
    @State private var results: [TimetableCategory] = []
    @State private var isLoading = false
    @State private var errorText: String?

    private let source: TimetableSource = DCUAPIClient()

    var body: some View {
        NavigationStack {
            List {
                Group {
                if let errorText {
                    Label(errorText, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(Theme.inkSecondary)
                }
                ForEach(results) { category in
                    Button {
                        onSelect(category)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(category.code).font(.headline).foregroundStyle(Theme.ink)
                            Text(category.descriptiveName)
                                .font(.subheadline)
                                .foregroundStyle(Theme.inkSecondary)
                        }
                    }
                }
                if results.isEmpty && !isLoading && errorText == nil {
                    ContentUnavailableView(
                        query.isEmpty ? "Find your programme" : "No matches",
                        systemImage: "magnifyingglass",
                        description: Text(query.isEmpty
                            ? "Search for your course, e.g. \"Computer\" or a code like \"CASE\"."
                            : "Try a different search.")
                    )
                    .bareRow()
                }
                }
                .themedRows()
            }
            .listStyle(.grouped)
            .themedList()
            .navigationTitle("Your programme")
            .adaptiveLargeTitle()
            .searchable(text: $query, prompt: "Name or code")
            .overlay { if isLoading { ProgressView() } }
            .task(id: query) { await search() }
        }
    }

    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 2 else {
            results = []
            return
        }
        // Debounce.
        try? await Task.sleep(nanoseconds: 300_000_000)
        if Task.isCancelled { return }

        isLoading = true
        errorText = nil
        defer { isLoading = false }
        do {
            let found = try await source.searchProgrammes(query: trimmed)
            if !Task.isCancelled { results = found }
        } catch {
            if !Task.isCancelled {
                results = []
                errorText = (error as? LocalizedError)?.errorDescription ?? "Couldn't search right now."
            }
        }
    }
}

#if DEBUG
#Preview("Light") { PreviewScreen.programme.view.previewVariant(.light) }
#Preview("Dark") { PreviewScreen.programme.view.previewVariant(.dark) }
#Preview("Largest text") { PreviewScreen.programme.view.previewVariant(.largestText) }
#Preview("iPhone SE", traits: .fixedLayout(width: 375, height: 667)) {
    PreviewScreen.programme.view
}
#endif
