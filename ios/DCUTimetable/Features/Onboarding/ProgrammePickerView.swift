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
                if let errorText {
                    Label(errorText, systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.secondary)
                }
                ForEach(results) { category in
                    Button {
                        onSelect(category)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(category.code).font(.headline)
                            Text(category.descriptiveName)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
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
                }
            }
            .navigationTitle("Your programme")
            .searchable(text: $query, prompt: "Programme name or code")
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
