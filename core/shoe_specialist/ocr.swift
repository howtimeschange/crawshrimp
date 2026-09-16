import Foundation
import Vision
import ImageIO
struct Job: Decodable {let id:String; let path:String}
let input=URL(fileURLWithPath:CommandLine.arguments[1])
let jobs=try JSONDecoder().decode([Job].self,from:Data(contentsOf:input))
for job in jobs {
 do {
 let req=VNRecognizeTextRequest()
 req.recognitionLevel = .accurate
 req.recognitionLanguages = ["zh-Hans","en-US"]
 req.usesLanguageCorrection = false
 let start=Date()
 try VNImageRequestHandler(url:URL(fileURLWithPath:job.path),options:[:]).perform([req])
 let lines=(req.results ?? []).compactMap { o -> [String:Any]? in
  guard let c=o.topCandidates(1).first else{return nil}
  return ["text":c.string,"confidence":c.confidence,"box":[o.boundingBox.minX,o.boundingBox.minY,o.boundingBox.width,o.boundingBox.height]]
 }
 let data=try JSONSerialization.data(withJSONObject:["id":job.id,"lines":lines,"seconds":Date().timeIntervalSince(start)],options:[.sortedKeys])
 print(String(data:data,encoding:.utf8)!)
 } catch { print("{\"id\":\"\(job.id)\",\"error\":\"OCR failed\"}") }
}
