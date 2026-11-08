using UnityEngine;
namespace UCW {
 public class ParkingZone : MonoBehaviour {
  [SerializeField] float maxSpeedKmh=5f;
  [SerializeField] float maxDistanceFromCenter=2.2f;
  [SerializeField] string missionCode="parking_basic";
  bool completed;
  void OnTriggerStay(Collider other){
   if(completed)return;
   var rb=other.attachedRigidbody;if(!rb)return;
   float speed=rb.velocity.magnitude*3.6f;
   Vector3 local=transform.InverseTransformPoint(rb.worldCenterOfMass);
   if(speed<=maxSpeedKmh && Mathf.Abs(local.x)<=maxDistanceFromCenter && Mathf.Abs(local.z)<=maxDistanceFromCenter){
    completed=true;Debug.Log("Parking challenge complete: "+missionCode);
   }
  }
 }
}
