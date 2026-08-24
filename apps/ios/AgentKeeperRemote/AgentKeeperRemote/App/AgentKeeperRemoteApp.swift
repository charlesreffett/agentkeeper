import SwiftUI

@main
struct AgentKeeperRemoteApp: App {
    @StateObject private var config = AppConfig.shared

    var body: some Scene {
        WindowGroup {
            ContentView(config: config)
        }
    }
}
