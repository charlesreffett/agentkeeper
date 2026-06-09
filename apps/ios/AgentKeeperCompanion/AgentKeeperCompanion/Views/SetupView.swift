import SwiftUI

struct SetupView: View {
    @ObservedObject var config: AppConfig
    var onDismiss: (() -> Void)? = nil

    @State private var urlField = ""
    @State private var keyField = ""
    @State private var isValidating = false
    @State private var error: String? = nil

    var body: some View {
        NavigationStack {
            Form {
                Section("Desktop Server") {
                    TextField("URL (e.g. http://192.168.1.10:57372)", text: $urlField)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                    SecureField("Secret Key", text: $keyField)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                }
                if let error {
                    Section {
                        Text(error).foregroundStyle(.red).font(.footnote)
                    }
                }
            }
            .navigationTitle("Setup")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await validate() } }
                        .disabled(urlField.isEmpty || keyField.isEmpty || isValidating)
                }
                if onDismiss != nil {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { onDismiss?() }
                    }
                }
            }
            .onAppear {
                urlField = config.baseURL
                keyField = config.secretKey
            }
        }
    }

    private func validate() async {
        isValidating = true
        error = nil
        let testConfig = AppConfig.shared
        testConfig.save(baseURL: urlField, secretKey: keyField)
        let client = APIClient(config: testConfig)
        do {
            _ = try await client.health()
            config.save(baseURL: urlField, secretKey: keyField)
            onDismiss?()
        } catch {
            self.error = "Cannot reach server: \(error.localizedDescription)"
        }
        isValidating = false
    }
}
