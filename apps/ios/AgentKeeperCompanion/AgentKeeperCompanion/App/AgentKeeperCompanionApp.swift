import SwiftUI

@main
struct AgentKeeperCompanionApp: App {
    @StateObject private var config = AppConfig.shared

    var body: some Scene {
        WindowGroup {
            ContentView(config: config)
        }
    }
}
