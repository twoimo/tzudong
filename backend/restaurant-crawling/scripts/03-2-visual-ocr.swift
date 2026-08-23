import Foundation
import Vision
import ImageIO
import CoreGraphics

struct Payload: Encodable {
    let texts: [String]
}

func fail(_ code: String) -> Never {
    FileHandle.standardError.write(Data("\(code)\n".utf8))
    exit(2)
}

guard CommandLine.arguments.count == 2 else { fail("ocr_args") }
let path = CommandLine.arguments[1]
let url = URL(fileURLWithPath: path)
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("ocr_image")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["ko-KR", "en-US"]

let handler = VNImageRequestHandler(cgImage: image, options: [:])
do {
    try handler.perform([request])
} catch {
    fail("ocr_perform")
}

let texts = (request.results ?? []).compactMap { observation in
    observation.topCandidates(1).first?.string
}.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

let data = try JSONEncoder().encode(Payload(texts: texts))
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write(Data("\n".utf8))
