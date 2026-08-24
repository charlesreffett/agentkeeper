import SwiftUI

struct ContentView: View {
    @ObservedObject var config: AppConfig

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
