import HealthMateCore
import MapKit
import Observation
import SwiftUI

enum CareKind: String, CaseIterable, Identifiable {
    case emergency, urgentCare, doctor, pharmacy
    var id: String { rawValue }

    var title: String {
        switch self {
        case .emergency: return "Emergency"
        case .urgentCare: return "Urgent care"
        case .doctor: return "Doctors"
        case .pharmacy: return "Pharmacies"
        }
    }

    var query: String {
        switch self {
        case .emergency: return "hospital emergency room"
        case .urgentCare: return "urgent care clinic"
        case .doctor: return "doctor"
        case .pharmacy: return "pharmacy"
        }
    }

    var systemImage: String {
        switch self {
        case .emergency: return "cross.case.fill"
        case .urgentCare: return "stethoscope"
        case .doctor: return "person.crop.circle.badge.checkmark"
        case .pharmacy: return "pills.fill"
        }
    }
}

struct CarePlace: Identifiable, Equatable {
    let id: String
    let name: String
    let address: String?
    let phone: String?
    let coordinate: CLLocationCoordinate2D
    let distanceMeters: Double?
    let mapItem: MKMapItem

    static func == (lhs: CarePlace, rhs: CarePlace) -> Bool { lhs.id == rhs.id }
}

/// Searches Apple Maps for care near the person. Results come from Apple Maps;
/// HealthMate doesn't rank, rate or endorse providers.
@MainActor
@Observable
final class CareFinderModel {
    enum State: Equatable { case idle, locating, searching, loaded, failed(String) }

    var kind: CareKind = .urgentCare
    private(set) var state: State = .idle
    private(set) var places: [CarePlace] = []
    private(set) var userLocation: CLLocation?
    private(set) var locationDenied = false

    private let location = LocationProvider()

    func load() async {
        if userLocation == nil, !locationDenied {
            state = .locating
            do {
                userLocation = try await location.currentLocation()
            } catch {
                locationDenied = (error as? LocationProvider.LocationError) == .denied
            }
        }
        await search()
    }

    func search() async {
        state = .searching
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = kind.query
        request.resultTypes = .pointOfInterest
        if let userLocation {
            request.region = MKCoordinateRegion(center: userLocation.coordinate, latitudinalMeters: 15_000, longitudinalMeters: 15_000)
        }
        do {
            let response = try await MKLocalSearch(request: request).start()
            let origin = userLocation
            places = response.mapItems.prefix(20).map { item in
                let placemark = item.placemark
                return CarePlace(
                    id: "\(placemark.coordinate.latitude),\(placemark.coordinate.longitude),\(item.name ?? "")",
                    name: item.name ?? "Unnamed place",
                    address: Self.address(placemark),
                    phone: item.phoneNumber,
                    coordinate: placemark.coordinate,
                    distanceMeters: origin.map { placemark.location?.distance(from: $0) } ?? nil,
                    mapItem: item
                )
            }
            .sorted { ($0.distanceMeters ?? .greatestFiniteMagnitude) < ($1.distanceMeters ?? .greatestFiniteMagnitude) }
            state = .loaded
        } catch {
            places = []
            state = .failed(locationDenied
                ? "Turn on location for HealthMate in Settings to see places near you."
                : "We couldn't search Apple Maps right now. Check your connection and try again.")
        }
    }

    private static func address(_ placemark: MKPlacemark) -> String? {
        let parts = [placemark.subThoroughfare, placemark.thoroughfare, placemark.locality].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }
}

/// Find emergency departments, urgent care, doctors and pharmacies nearby.
struct CareFinderView: View {
    @State private var model = CareFinderModel()
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)
    @State private var selected: CarePlace.ID?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    private var emergencyNumber: String { SafetyEngine.emergencyNumber(regionCode: Locale.current.region?.identifier) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                emergencyBanner
                Picker("Type of care", selection: $model.kind) {
                    ForEach(CareKind.allCases) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, HM.Spacing.lg)
                .padding(.vertical, 10)

                Map(position: $camera, selection: $selected) {
                    UserAnnotation()
                    ForEach(model.places) { place in
                        Marker(place.name, systemImage: model.kind.systemImage, coordinate: place.coordinate)
                            .tint(model.kind == .emergency ? HM.Colors.error : HM.Colors.primary)
                            .tag(place.id)
                    }
                }
                .frame(height: 220)
                .accessibilityHidden(true)

                list
            }
            .background(HM.Colors.background.ignoresSafeArea())
            .navigationTitle("Find care")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
        }
        .task { await model.load() }
        .onChange(of: model.kind) { _, _ in
            selected = nil
            Task { await model.search() }
        }
        .onChange(of: model.places) { _, _ in camera = .automatic }
    }

    private var emergencyBanner: some View {
        Button {
            if let url = URL(string: "tel://\(emergencyNumber)") { openURL(url) }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "phone.fill")
                Text("In an emergency, call \(emergencyNumber) now")
                    .font(.hmBodyEmphasis)
                Spacer()
                Image(systemName: "chevron.right").font(.caption.weight(.bold))
            }
            .foregroundStyle(HM.Colors.onPrimary)
            .padding(.horizontal, HM.Spacing.lg)
            .padding(.vertical, 12)
            .background(HM.Colors.errorFill)
        }
        .accessibilityLabel("Call emergency services, \(emergencyNumber)")
    }

    @ViewBuilder
    private var list: some View {
        switch model.state {
        case .idle, .locating, .searching:
            VStack(spacing: 10) {
                ProgressView()
                Text(model.state == .locating ? "Finding your location…" : "Searching Apple Maps…")
                    .font(.hmCaption)
                    .foregroundStyle(HM.Colors.textSecondary)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            EmptyStateView(systemImage: "map", tone: .orange, title: "No results", message: message) {
                Button("Try again") { Task { await model.load() } }.buttonStyle(.hmPrimary)
            }
            .frame(maxHeight: .infinity)
        case .loaded where model.places.isEmpty:
            EmptyStateView(systemImage: "mappin.slash", title: "Nothing found nearby", message: "Try another type of care, or search in Apple Maps.")
                .frame(maxHeight: .infinity)
        case .loaded:
            ScrollViewReader { proxy in
                List(model.places) { place in
                    CarePlaceRow(place: place, highlighted: selected == place.id)
                        .id(place.id)
                        .listRowBackground(HM.Colors.card)
                }
                .listStyle(.plain)
                .safeAreaInset(edge: .bottom) {
                    Text(model.locationDenied
                        ? "Location is off, so results may not be near you. Results from Apple Maps; HealthMate doesn't endorse providers."
                        : "Results from Apple Maps. HealthMate doesn't endorse providers — check opening hours before you go.")
                        .font(.hmMicro)
                        .foregroundStyle(HM.Colors.textMuted)
                        .padding(.horizontal, HM.Spacing.lg)
                        .padding(.vertical, 8)
                        .frame(maxWidth: .infinity)
                        .background(.bar)
                }
                .onChange(of: selected) { _, id in
                    if let id { withAnimation { proxy.scrollTo(id, anchor: .top) } }
                }
            }
        }
    }
}

private struct CarePlaceRow: View {
    let place: CarePlace
    let highlighted: Bool
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(place.name).font(.hmBodyEmphasis).foregroundStyle(HM.Colors.textPrimary)
                Spacer()
                if let distance = place.distanceMeters {
                    Text(Measurement(value: distance, unit: UnitLength.meters), format: .measurement(width: .abbreviated, usage: .road))
                        .font(.hmCaption)
                        .foregroundStyle(HM.Colors.textSecondary)
                }
            }
            if let address = place.address {
                Text(address).font(.hmCaption).foregroundStyle(HM.Colors.textSecondary)
            }
            HStack(spacing: 10) {
                Button {
                    place.mapItem.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDefault])
                } label: {
                    Label("Directions", systemImage: "arrow.triangle.turn.up.right.diamond.fill")
                }
                .buttonStyle(.hmPrimary(compact: true))
                if let phone = place.phone, let url = URL(string: "tel://\(phone.filter { $0.isNumber || $0 == "+" })") {
                    Button { openURL(url) } label: { Label("Call", systemImage: "phone.fill") }
                        .buttonStyle(SecondaryButtonStyle(compact: true))
                }
            }
        }
        .padding(.vertical, 6)
        .overlay(alignment: .leading) {
            if highlighted {
                RoundedRectangle(cornerRadius: 2).fill(HM.Colors.primary).frame(width: 3).offset(x: -12)
            }
        }
        .accessibilityElement(children: .contain)
    }
}
