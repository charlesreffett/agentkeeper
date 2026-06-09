import SwiftUI

struct ContentView: View {
    @StateObject private var config = AppConfig.shared

    var body: some View {
        if config.isConfigured {
            NavigationStack {
                SessionsListView(config: config)
            }
        } else {
            SetupView(config: config)
        }
    }
}
