import SwiftUI

/// Pure-SwiftUI "Ekwe Echo" share sheet mirroring the Android ShareActivity:
/// scrim, bottom card with 24dp top radius, drag handle, uppercase "Ekwe Echo"
/// label, and a sonar pulse while the voice note is being prepared.
///
/// The whole echo pipeline runs natively in the extension process — no JS
/// runtime, no deep-link handoff. Steps map 1:1 to the RN `useEchoFlow`
/// state machine:
///
///   signedOut → pickingLanguage → preview → transcribing
///            → transcriptionReady → translating → resultReady
///   any → failed
@available(iOS 16.4, *)
struct EchoShareSheet: View {

    @ObservedObject var model: EchoShareModel
    let onClose: () -> Void

    @Environment(\.colorScheme) private var scheme

    /// Chips offered as translation targets (top languages ≠ source).
    @State private var targetCandidates: [EchoPickLanguage] = []

    /// Whether the "Auto-Detect · Paid" locked card was tapped by a free user.
    @State private var showAutoDetectLocked = false

    var body: some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(scrimOpacity)

            VStack(spacing: 0) {
                switch model.step {
                case .idle, .loadingSession:
                    loadingCard
                case .signedOut:
                    signedOutCard
                case .pickingLanguage:
                    pickLanguageCard
                case .preview:
                    previewCard
                case .transcribing:
                    transcribingCard
                case .transcriptionReady:
                    transcriptionCard
                case .translating:
                    translatingCard
                case .resultReady:
                    resultCard
                case .failed(let message):
                    errorCard(message: message)
                }
            }
        }
        .ignoresSafeArea()
        .animation(.easeInOut(duration: 0.25), value: model.step)
        .onAppear { bootstrapTargetCandidates() }
        .alert(
            "Auto-Detect is a paid feature",
            isPresented: $showAutoDetectLocked
        ) {
            Button("OK", role: .cancel) { showAutoDetectLocked = false }
        } message: {
            Text("Upgrade to Ekwe Paid in the app to auto-detect this voice note's language.")
        }
    }

    // MARK: - Token helpers

    private var foregroundFill: Color { EchoDesignTokens.Semantic.foreground.color(scheme) }
    private var backgroundFill: Color { EchoDesignTokens.Semantic.background.color(scheme) }
    private var cardFill: Color { EchoDesignTokens.Semantic.card.color(scheme) }
    private var surfaceFill: Color { EchoDesignTokens.Semantic.surface.color(scheme) }
    private var borderFill: Color { EchoDesignTokens.Semantic.border.color(scheme) }
    private var mutedFill: Color { EchoDesignTokens.Semantic.muted.color(scheme) }
    private var brandFill: Color { EchoDesignTokens.Semantic.brand.color(scheme) }
    private var onBrandFill: Color { EchoDesignTokens.Semantic.onBrand.color(scheme) }
    private var successFill: Color { EchoDesignTokens.Semantic.success.color(scheme) }
    private var errorFill: Color { EchoDesignTokens.Semantic.error.color(scheme) }

    private var handleFill: Color { EchoDesignTokens.Semantic.handle.color(scheme) }
    private var pulseFill: Color { EchoDesignTokens.Semantic.brand.color(scheme) }

    private var scrimOpacity: Double {
        let overlay = EchoDesignTokens.Semantic.overlay
        return scheme == .dark ? overlay.dark.opacity : overlay.light.opacity
    }

    // MARK: - Card scaffold

    private func card<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            dragHandle
            content()
        }
        .padding(.horizontal, 24)
        .padding(.bottom, 40)
        .padding(.top, 20)
        .frame(maxWidth: .infinity)
        .background(
            cardFill
                .clipShape(
                    UnevenRoundedRectangle(
                        topLeadingRadius: 24,
                        bottomLeadingRadius: 0,
                        bottomTrailingRadius: 0,
                        topTrailingRadius: 24
                    )
                )
        )
        .shadow(color: .black.opacity(0.12), radius: 24, y: -4)
    }

    private var dragHandle: some View {
        Capsule()
            .fill(handleFill)
            .frame(width: 40, height: 4)
            .padding(.bottom, 20)
            .accessibilityHidden(true)
    }

    // MARK: - Header

    private func header(right: (() -> some View)? = nil) -> some View {
        HStack(spacing: 8) {
            Circle()
                .fill(brandFill)
                .frame(width: 8, height: 8)
            Text("Ekwe Echo".uppercased())
                .font(EchoFonts.custom("Outfit-Regular", size: 10))
                .tracking(1.5)
                .foregroundStyle(mutedFill)
            Spacer()
            if let right {
                right()
            }
        }
        .padding(.bottom, 16)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(foregroundFill)
                .frame(width: 32, height: 32)
                .background(Circle().fill(surfaceFill))
        }
        .buttonStyle(BorderlessButtonStyle())
        .accessibilityLabel("Close Echo")
    }

    // MARK: - Loading

    private var loadingCard: some View {
        card {
            header(right: { closeButton })

            PulseRingView(pulse: pulseFill)
                .padding(.bottom, 24)

            Text("Preparing voice note…")
                .font(EchoFonts.custom("Outfit-Regular", size: 14))
                .foregroundStyle(foregroundFill)
                .frame(maxWidth: .infinity)
        }
    }

    // MARK: - Signed out

    private var signedOutCard: some View {
        card {
            header(right: { closeButton })

            VStack(spacing: 12) {
                Image(systemName: "person.crop.circle.badge.exclamationmark")
                    .font(.system(size: 32))
                    .foregroundStyle(brandFill)
                Text("Sign in to use Ekwe Echo")
                    .font(EchoFonts.custom("Outfit-Bold", size: 20))
                    .foregroundStyle(foregroundFill)
                Text("Open the Ekwe app, sign in, then share this voice note again to transcribe it.")
                    .font(EchoFonts.custom("Outfit-Regular", size: 14))
                    .foregroundStyle(mutedFill)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 24)

            Button("Close", action: onClose)
                .font(EchoFonts.custom("Outfit-Medium", size: 16))
                .foregroundStyle(onBrandFill)
                .frame(maxWidth: .infinity)
                .frame(height: 52)
                .background(Capsule().fill(brandFill))
                .padding(.top, 8)
        }
    }

    // MARK: - Pick language

    private var pickLanguageCard: some View {
        card {
            header(right: { closeButton })

            Text("What language is this?")
                .font(EchoFonts.custom("Outfit-Bold", size: 20))
                .foregroundStyle(foregroundFill)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 4)
            Text("Pick the voice note's language so transcription gets it right.")
                .font(EchoFonts.custom("Outfit-Regular", size: 14))
                .foregroundStyle(mutedFill)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 20)

            let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 3)
            LazyVGrid(columns: columns, spacing: 12) {
                autoDetectCard
                ForEach(model.userLanguages()) { lang in
                    languageCard(lang)
                }
            }
            .padding(.bottom, 20)

            Button(action: onClose) {
                Text("Cancel")
                    .font(EchoFonts.custom("Outfit-Medium", size: 16))
                    .foregroundStyle(mutedFill)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
            }
            .buttonStyle(BorderlessButtonStyle())
        }
    }

    private var autoDetectCard: some View {
        Button {
            if model.autoDetectAllowed {
                model.selectLanguage("auto")
            } else {
                showAutoDetectLocked = true
            }
        } label: {
            VStack(spacing: 8) {
                Image(systemName: model.autoDetectAllowed ? "sparkles" : "lock")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(model.autoDetectAllowed ? pulseFill : mutedFill)
                Text(model.autoDetectAllowed ? "Auto-Detect" : "Auto-Detect · Paid")
                    .font(EchoFonts.custom("Outfit-Medium", size: 12))
                    .foregroundStyle(model.autoDetectAllowed ? pulseFill : mutedFill)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 96)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(backgroundFill))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(
                        model.autoDetectAllowed ? pulseFill.opacity(0.5) : borderFill,
                        style: StrokeStyle(lineWidth: 1, dash: [4, 3])
                    )
            )
        }
        .buttonStyle(BorderlessButtonStyle())
        .accessibilityLabel(
            model.autoDetectAllowed
                ? "Auto-detect language"
                : "Auto-detect language, paid feature"
        )
    }

    private func languageCard(_ lang: EchoPickLanguage) -> some View {
        Button {
            model.selectLanguage(lang.code)
        } label: {
            VStack(spacing: 8) {
                Text(lang.flag)
                    .font(.system(size: 24))
                Text(lang.name)
                    .font(EchoFonts.custom("Outfit-Medium", size: 12))
                    .foregroundStyle(foregroundFill)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .frame(minHeight: 96)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(backgroundFill))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(borderFill, lineWidth: 1)
            )
        }
        .buttonStyle(BorderlessButtonStyle())
        .accessibilityLabel("\(lang.name) (\(lang.flag))")
    }

    // MARK: - Preview

    private var previewCard: some View {
        card {
            header(right: { closeButton })

            Text("Preview & Transcribe")
                .font(EchoFonts.custom("Outfit-Bold", size: 20))
                .foregroundStyle(foregroundFill)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 4)
            Text(languageSummary)
                .font(EchoFonts.custom("Outfit-Regular", size: 14))
                .foregroundStyle(mutedFill)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 16)

            transportRow
                .padding(.bottom, 12)

            Slider(value: Binding(
                get: { model.progress },
                set: { model.seek(to: $0) }
            ), in: 0...1)
            .tint(brandFill)
            .padding(.bottom, 12)

            HStack(spacing: 8) {
                Image(systemName: "waveform")
                    .font(.system(size: 14))
                    .foregroundStyle(mutedFill)
                Text(model.fileName)
                    .font(EchoFonts.custom("Outfit-Regular", size: 14))
                    .foregroundStyle(foregroundFill)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer()
                Text(model.fileSizeText)
                    .font(EchoFonts.custom("Outfit-Regular", size: 12))
                    .foregroundStyle(mutedFill)
            }
            .padding(.bottom, 20)

            Button(action: { Task { await model.transcribe() } }) {
                HStack(spacing: 8) {
                    Image(systemName: "bolt.fill")
                        .font(.system(size: 14, weight: .semibold))
                    Text("Transcribe")
                        .font(EchoFonts.custom("Outfit-Medium", size: 16))
                }
                .foregroundStyle(onBrandFill)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(Capsule().fill(brandFill))
            }
            .buttonStyle(BorderlessButtonStyle())
            .accessibilityHint("Starts native transcription")
        }
    }

    private var languageSummary: String {
        if model.selectedLang == "auto" { return "Auto-Detect · this voice note" }
        if let lang = EchoLanguages.find(model.selectedLang) {
            return "\(lang.flag) \(lang.englishName) · this voice note"
        }
        return "This voice note"
    }

    private var transportRow: some View {
        HStack(spacing: 12) {
            Button(action: model.togglePlay) {
                Image(systemName: model.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(onBrandFill)
                    .frame(width: 48, height: 48)
                    .background(Circle().fill(brandFill))
            }
            .buttonStyle(BorderlessButtonStyle())
            .accessibilityLabel(model.isPlaying ? "Pause playback" : "Play voice note")

            VStack(spacing: 8) {
                WaveformView(peaks: model.peaks, played: model.progress)
                    .frame(height: 40)
                    .frame(maxWidth: .infinity)

                HStack(spacing: 8) {
                    Text("\(model.formattedTime(model.progress * model.duration)) / \(model.formattedTime(model.duration))")
                        .font(EchoFonts.custom("Outfit-Regular", size: 12))
                        .monospacedDigit()
                        .foregroundStyle(mutedFill)
                    Spacer()
                    Button(action: model.cycleRate) {
                        Text(String(format: "%gx", model.rate))
                            .font(EchoFonts.custom("Outfit-Medium", size: 12))
                            .foregroundStyle(foregroundFill)
                            .padding(.horizontal, 8)
                            .frame(minHeight: 28)
                            .background(Capsule().fill(surfaceFill))
                    }
                    .buttonStyle(BorderlessButtonStyle())
                    .accessibilityLabel("Playback speed")
                }
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(backgroundFill))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(borderFill, lineWidth: 1)
        )
    }

    // MARK: - Transcribing

    private var transcribingCard: some View {
        card {
            header(right: { closeButton })

            VStack(spacing: 20) {
                if model.transcribePhase == .uploading {
                    ZStack {
                        Circle()
                            .stroke(surfaceFill, lineWidth: 8)
                            .frame(width: 96, height: 96)
                        Circle()
                            .trim(from: 0, to: model.uploadProgress)
                            .stroke(brandFill, style: StrokeStyle(lineWidth: 8, lineCap: .round))
                            .frame(width: 96, height: 96)
                            .rotationEffect(.degrees(-90))
                        Text("\(Int(model.uploadProgress * 100))%")
                            .font(EchoFonts.custom("Outfit-Bold", size: 18))
                            .foregroundStyle(foregroundFill)
                    }
                    .accessibilityLabel("Uploading \(Int(model.uploadProgress * 100)) percent")
                } else {
                    ProgressView()
                        .tint(brandFill)
                        .scaleEffect(1.6)
                        .frame(width: 96, height: 96)
                        .accessibilityHidden(true)
                }

                Text(model.transcribePhase == .uploading ? "Uploading audio…" : "Transcribing…")
                    .font(EchoFonts.custom("Outfit-Medium", size: 16))
                    .foregroundStyle(foregroundFill)

                Button(action: model.cancelActivity) {
                    Text("Cancel")
                        .font(EchoFonts.custom("Outfit-Medium", size: 16))
                        .foregroundStyle(mutedFill)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                }
                .buttonStyle(BorderlessButtonStyle())
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }
    }

    // MARK: - Transcription ready

    private var transcriptionCard: some View {
        card {
            header(right: { closeButton })

            Text("Transcript")
                .font(EchoFonts.custom("Outfit-Bold", size: 20))
                .foregroundStyle(foregroundFill)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 4)

            if let provider = model.transcriptionProvider {
                Text("via \(provider)")
                    .font(EchoFonts.custom("Outfit-Regular", size: 12))
                    .foregroundStyle(mutedFill)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 16)
            }

            ScrollView {
                Text(model.transcriptText.isEmpty ? "…" : model.transcriptText)
                    .font(EchoFonts.custom("Outfit-Regular", size: 15))
                    .foregroundStyle(foregroundFill)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxHeight: 220)
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(backgroundFill))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(borderFill, lineWidth: 1)
            )
            .padding(.bottom, 16)

            transportRow
                .padding(.bottom, 16)

            Text("Translate to")
                .font(EchoFonts.custom("Outfit-Medium", size: 13))
                .foregroundStyle(mutedFill)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 8)

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(targetCandidates) { lang in
                        targetChip(lang)
                    }
                }
            }
            .padding(.bottom, 16)

            Button(action: { Task { await model.translate() } }) {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.right.arrow.left")
                        .font(.system(size: 14, weight: .semibold))
                    Text("Translate")
                        .font(EchoFonts.custom("Outfit-Medium", size: 16))
                }
                .foregroundStyle(onBrandFill)
                .frame(maxWidth: .infinity)
                .frame(height: 54)
                .background(Capsule().fill(brandFill))
            }
            .buttonStyle(BorderlessButtonStyle())
        }
    }

    private func targetChip(_ lang: EchoPickLanguage) -> some View {
        Button {
            model.setTargetLanguage(lang.code)
        } label: {
            Text("\(lang.flag) \(lang.name)")
                .font(EchoFonts.custom("Outfit-Medium", size: 13))
                .foregroundStyle(model.targetLang == lang.code ? onBrandFill : foregroundFill)
                .padding(.horizontal, 12)
                .frame(minHeight: 32)
                .background(Capsule().fill(model.targetLang == lang.code ? brandFill : surfaceFill))
        }
        .buttonStyle(BorderlessButtonStyle())
    }

    // MARK: - Translating

    private var translatingCard: some View {
        card {
            header(right: { closeButton })

            ProgressView()
                .tint(brandFill)
                .scaleEffect(1.6)
                .frame(width: 96, height: 96)
                .padding(.bottom, 16)
                .accessibilityHidden(true)

            Text("Translating…")
                .font(EchoFonts.custom("Outfit-Medium", size: 16))
                .foregroundStyle(foregroundFill)
                .frame(maxWidth: .infinity)
                .padding(.bottom, 16)

            Button(action: model.cancelActivity) {
                Text("Cancel")
                    .font(EchoFonts.custom("Outfit-Medium", size: 16))
                    .foregroundStyle(mutedFill)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
            }
            .buttonStyle(BorderlessButtonStyle())
        }
    }

    // MARK: - Result

    private var resultCard: some View {
        card {
            header(right: { closeButton })

            Text("Translated")
                .font(EchoFonts.custom("Outfit-Bold", size: 20))
                .foregroundStyle(foregroundFill)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.bottom, 4)

            if let provider = model.translationProvider {
                Text("via \(provider)")
                    .font(EchoFonts.custom("Outfit-Regular", size: 12))
                    .foregroundStyle(mutedFill)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 16)
            }

            ScrollView {
                Text(model.translationText.isEmpty ? "…" : model.translationText)
                    .font(EchoFonts.custom("Outfit-Regular", size: 15))
                    .foregroundStyle(foregroundFill)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxHeight: 220)
            .padding(16)
            .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(backgroundFill))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(borderFill, lineWidth: 1)
            )
            .padding(.bottom, 16)

            transportRow
                .padding(.bottom, 16)

            HStack(spacing: 8) {
                copyButton(label: model.didAutoCopy ? "Copied" : "Copy", copied: model.didAutoCopy) {
                    model.copyTranslation()
                }
                if let target = EchoLanguages.find(model.targetLang) {
                    Button {
                        model.backToTranscription()
                    } label: {
                        Text("Re-translate")
                            .font(EchoFonts.custom("Outfit-Medium", size: 15))
                            .foregroundStyle(foregroundFill)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(Capsule().fill(surfaceFill))
                    }
                    .buttonStyle(BorderlessButtonStyle())
                    .accessibilityLabel("Re-translate to \(target.englishName)")
                }
            }
            .padding(.bottom, 12)

            HStack(spacing: 8) {
                Button(action: onClose) {
                    Text("Done")
                        .font(EchoFonts.custom("Outfit-Medium", size: 16))
                        .foregroundStyle(onBrandFill)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(Capsule().fill(brandFill))
                }
                .buttonStyle(BorderlessButtonStyle())
            }
        }
    }

    private func copyButton(label: String, copied: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 13, weight: .semibold))
                Text(label)
                    .font(EchoFonts.custom("Outfit-Medium", size: 15))
            }
            .foregroundStyle(copied ? successFill : foregroundFill)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Capsule().fill(surfaceFill))
        }
        .buttonStyle(BorderlessButtonStyle())
    }

    // MARK: - Error

    private func errorCard(message: String) -> some View {
        card {
            header(right: { closeButton })
            VStack(spacing: 12) {
                Image(systemName: "exclamationmark.circle.fill")
                    .font(.system(size: 32))
                    .foregroundStyle(errorFill)
                Text("Something went wrong")
                    .font(EchoFonts.custom("Outfit-Bold", size: 20))
                    .foregroundStyle(foregroundFill)
                Text(message)
                    .font(EchoFonts.custom("Outfit-Regular", size: 14))
                    .foregroundStyle(mutedFill)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 32)

            Button(action: onClose) {
                Text("Close")
                    .font(EchoFonts.custom("Outfit-Medium", size: 16))
                    .foregroundStyle(onBrandFill)
                    .frame(maxWidth: .infinity)
                    .frame(height: 52)
                    .background(Capsule().fill(brandFill))
            }
            .buttonStyle(BorderlessButtonStyle())
        }
    }

    // MARK: - Helpers

    private func bootstrapTargetCandidates() {
        guard targetCandidates.isEmpty else { return }
        let languages = model.userLanguages()
        targetCandidates = languages.filter { $0.code != model.selectedLang }
        if targetCandidates.isEmpty {
            targetCandidates = languages
        }
        if model.targetLang.isEmpty, let first = targetCandidates.first {
            model.setTargetLanguage(first.code)
        }
    }
}

// MARK: - SonarPulse

/// The Android pulse: a 2pt stroked ring with a filled center dot; the ring
/// scales 0.6→1.2 and fades on a repeating 1800ms loop.
@available(iOS 16.4, *)
private struct PulseRingView: View {

    let pulse: Color

    @State private var pulsing = false

    var body: some View {
        ZStack {
            Circle()
                .stroke(pulse, lineWidth: 2)
                .frame(width: 60, height: 60)
                .scaleEffect(pulsing ? 1.2 : 0.6)
                .opacity(pulsing ? 0.2 : 1.0)

            Circle()
                .fill(pulse)
                .frame(width: 16, height: 16)
        }
        .frame(width: 88, height: 88)
        .onAppear { withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulsing.toggle() } }
        .accessibilityHidden(true)
    }
}

// MARK: - Waveform

/// Static preview of the audio peaks. Bars at/before `played` render in the
/// brand color (played), the rest muted (not yet played) — mirroring the app's
/// Skia waveform.
@available(iOS 16.4, *)
struct WaveformView: View {

    let peaks: [Double]
    let played: Double

    @Environment(\.colorScheme) private var scheme

    var body: some View {
        GeometryReader { geo in
            let safeCount = max(peaks.count, 1)
            let spacing: CGFloat = 2
            let barWidth = max(2, (geo.size.width - (CGFloat(safeCount) + 1) * spacing) / CGFloat(safeCount))
            let maxBarHeight = geo.size.height - 6

            HStack(spacing: spacing) {
                ForEach(peaks.indices, id: \.self) { index in
                    let fraction = safeCount == 1 ? 1 : Double(index) / Double(safeCount - 1)
                    let isPlayed = fraction <= played
                    Capsule()
                        .fill(isPlayed ? playedColor : idleColor)
                        .frame(width: barWidth, height: height(for: index, max: maxBarHeight))
                }
            }
            .frame(maxHeight: .infinity)
        }
        .accessibilityLabel("Audio waveform")
    }

    private var playedColor: Color {
        EchoDesignTokens.Semantic.brand.color(scheme)
    }

    private var idleColor: Color {
        EchoDesignTokens.Semantic.foreground.color(scheme).opacity(0.35)
    }

    private func height(for index: Int, max: CGFloat) -> CGFloat {
        guard !peaks.isEmpty else { return max * 0.2 }
        let value = max(peaks[index], 0.06)
        return max * CGFloat(value)
    }
}
