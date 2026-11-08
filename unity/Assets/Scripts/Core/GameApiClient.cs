using System;
using System.Collections;
using System.Text;
using UnityEngine;
using UnityEngine.Networking;
namespace UCW {
 [Serializable] public class LoginRequest { public string username; public string password; }
 [Serializable] public class LoginResponse { public string token; public UserDto user; }
 [Serializable] public class UserDto { public int id; public string username; public string role; public int balanceYER; public int level; public int xp; }
 [Serializable] public class CarDto { public int id; public string code; public string name; public string category; public int priceYER; public int stock; public string description; public float topSpeed; public float accel; public float handling; public string color; }
 public class GameApiClient : MonoBehaviour {
  public static GameApiClient Instance {get; private set;}
  [SerializeField] string baseUrl = "http://127.0.0.1:8080";
  public string Token {get; private set;}
  void Awake(){ if(Instance!=null){Destroy(gameObject);return;} Instance=this;DontDestroyOnLoad(gameObject); }
  public IEnumerator Login(string username,string password,Action<LoginResponse> done,Action<string> fail){
   var body=JsonUtility.ToJson(new LoginRequest{username=username,password=password});
   using(var req=new UnityWebRequest(baseUrl+"/api/auth/login","POST")){
    req.uploadHandler=new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));req.downloadHandler=new DownloadHandlerBuffer();req.SetRequestHeader("Content-Type","application/json");
    yield return req.SendWebRequest();
    if(req.result!=UnityWebRequest.Result.Success){fail?.Invoke(req.downloadHandler.text);yield break;}
    var data=JsonUtility.FromJson<LoginResponse>(req.downloadHandler.text);Token=data.token;done?.Invoke(data);
   }
  }
  public IEnumerator GetCars(Action<string> done,Action<string> fail){
   using(var req=UnityWebRequest.Get(baseUrl+"/api/cars")){yield return req.SendWebRequest();if(req.result!=UnityWebRequest.Result.Success)fail?.Invoke(req.error);else done?.Invoke(req.downloadHandler.text);}
  }
  public IEnumerator BuyCar(int carId,Action<string> done,Action<string> fail){
   var body="{\"carId\":"+carId+"}";
   using(var req=new UnityWebRequest(baseUrl+"/api/garage/buy","POST")){
    req.uploadHandler=new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));req.downloadHandler=new DownloadHandlerBuffer();req.SetRequestHeader("Content-Type","application/json");req.SetRequestHeader("Authorization","Bearer "+Token);
    yield return req.SendWebRequest();if(req.result!=UnityWebRequest.Result.Success)fail?.Invoke(req.downloadHandler.text);else done?.Invoke(req.downloadHandler.text);
   }
  }
  public IEnumerator ActivateCar(int ownedId,Action<string> done,Action<string> fail){
   var body="{\"ownedCarId\":"+ownedId+"}";
   using(var req=new UnityWebRequest(baseUrl+"/api/garage/activate","POST")){
    req.uploadHandler=new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));req.downloadHandler=new DownloadHandlerBuffer();req.SetRequestHeader("Content-Type","application/json");req.SetRequestHeader("Authorization","Bearer "+Token);
    yield return req.SendWebRequest();if(req.result!=UnityWebRequest.Result.Success)fail?.Invoke(req.downloadHandler.text);else done?.Invoke(req.downloadHandler.text);
   }
  }
  public IEnumerator Telemetry(string eventName,string jsonData,Action<string> done,Action<string> fail){
   var body="{\"event\":\""+eventName+"\",\"data\":"+jsonData+"}";
   using(var req=new UnityWebRequest(baseUrl+"/api/telemetry","POST")){
    req.uploadHandler=new UploadHandlerRaw(Encoding.UTF8.GetBytes(body));req.downloadHandler=new DownloadHandlerBuffer();req.SetRequestHeader("Content-Type","application/json");req.SetRequestHeader("Authorization","Bearer "+Token);
    yield return req.SendWebRequest();if(req.result!=UnityWebRequest.Result.Success)fail?.Invoke(req.downloadHandler.text);else done?.Invoke(req.downloadHandler.text);
   }
  }
 }
}
